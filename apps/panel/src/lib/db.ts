import 'server-only'

// framework
import { Pool } from 'pg'

// types
import type { ActivityRow, DailyVolume, LineTotals } from '@/types/db'

// lib
import { BUSINESS_TIMEZONE } from './business-time'
import { env } from './env'

// One pool for the whole server, kept deliberately small: it shares Supabase's
// transaction pooler with the gateway and the bridge.
declare global {
  // eslint-disable-next-line no-var
  var __panelPool: Pool | undefined
}

const MAX_CONNECTIONS = 4

function pool(): Pool {
  if (!globalThis.__panelPool) {
    globalThis.__panelPool = new Pool({
      connectionString: env.bridgeDatabaseUrl,
      max: MAX_CONNECTIONS,
      // Holding connections open for minutes was tried and made things worse:
      // Supabase's pooler closes an idle connection from its own side, and pg
      // then hands the next query a dead socket. 30s outlives one page's burst
      // of queries and still yields before the pooler does.
      idleTimeoutMillis: 30_000,
      // Opening a connection takes 5-7 seconds from here; 10s turned ordinary
      // variance into a failed read, 15s absorbs it.
      connectionTimeoutMillis: 15_000,
    })

    // A client can fail while idle in the pool (pooler restart, network blip).
    // Without a listener that is an unhandled error that kills the process;
    // with one, pg discards the client and the next query opens a fresh one.
    globalThis.__panelPool.on('error', (error) => {
      console.warn('[panel] idle database client failed:', error.message)
    })
  }
  return globalThis.__panelPool
}

/**
 * Connection-level failures, as opposed to anything the query itself did
 * wrong. A malformed statement must never be retried — it fails identically.
 */
function isConnectionFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return (
    message.includes('Connection terminated') ||
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('ECONNRESET') ||
    message.includes('EAI_AGAIN') ||
    message.includes('ENOTFOUND') ||
    message.includes('Client has encountered a connection error')
  )
}

/**
 * Postgres `undefined_table` (code 42P01): a bridge.* table this build expects
 * that the bridge, which owns the schema, has not created yet. Normal between
 * a panel deploy and the next bridge deploy — every reader treats it as "not
 * available yet".
 */
export function isUndefinedTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42P01'
}

/** Past this, a failure was a slow network rather than a stumble worth repeating. */
const RETRY_IF_FAILED_WITHIN_MS = 5_000

/**
 * One retry, and only for a fast failure to reach the database at all.
 * Reaching Supabase's pooler takes 5-7 seconds and occasionally does not
 * resolve; since every read here treats a failure as "no data", a second
 * attempt usually lands on a pool that just discarded the bad client. Past
 * the time limit the link is slow, not unlucky, and repeating only doubles
 * the wait for the same failure.
 */
export async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const started = Date.now()
  try {
    const result = await pool().query(text, values)
    return result.rows as T[]
  } catch (error) {
    const elapsed = Date.now() - started
    if (!isConnectionFailure(error) || elapsed > RETRY_IF_FAILED_WITHIN_MS) throw error
    console.warn(`[panel] database connection failed after ${elapsed}ms, retrying once`)
    const result = await pool().query(text, values)
    return result.rows as T[]
  }
}

/**
 * Run `work` while holding a named Postgres lock, so no other copy of the
 * panel runs the same work at the same time. A transaction-level advisory
 * lock: released on commit, rollback, or a dropped connection, compatible
 * with the transaction-mode pooler. Waiting is capped — past the timeout
 * Postgres raises 55P03 (lock_not_available) rather than hanging.
 */
export async function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('begin')
    await client.query(`set local lock_timeout = '30s'`)
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [name])
    try {
      const result = await work()
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    }
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * Per-line message volume, from the bridge's own table — the gateway's counts
 * are permanently zero since message persistence is off there by design. The
 * table holds identifiers only, no message text.
 */
export async function lineTotals(): Promise<LineTotals[]> {
  return query<LineTotals>(`
    select instance,
           count(*) filter (where direction = 'inbound')::int  as "inbound",
           count(*) filter (where direction = 'outbound')::int as "outbound",
           count(distinct chatwoot_conversation_id)::int       as "conversations",
           max(created_at)                                     as "lastActivity"
    from bridge.message_map
    group by instance
  `)
}

/**
 * Message volume by day, zero-filled so quiet days stay visible as gaps.
 * Pass an instance to scope to one line. Days are business days — see
 * lib/business-time.ts.
 */
export async function dailyVolume(days = 14, instance?: string): Promise<DailyVolume[]> {
  return query<DailyVolume>(
    `
    with today as (
      -- Today in the business timezone, which past 6pm there is still yesterday in UTC.
      select (now() at time zone $3)::date as day
    ),
    span as (
      select generate_series(
        (today.day - ($1::int - 1) * interval '1 day')::date,
        today.day,
        interval '1 day'
      )::date as day
      from today
    )
    select to_char(span.day, 'YYYY-MM-DD') as "day",
           count(m.*) filter (where m.direction = 'inbound')::int  as "inbound",
           count(m.*) filter (where m.direction = 'outbound')::int as "outbound"
    from span
    left join bridge.message_map m
      on (m.created_at at time zone $3)::date = span.day
     and ($2::text is null or m.instance = $2)
    group by span.day
    order by span.day
  `,
    [days, instance ?? null, BUSINESS_TIMEZONE],
  )
}

/**
 * The last handful of messages this line handled — direction and timestamps
 * only, no content: the bridge stores identifiers so Chatwoot stays the single
 * copy of what customers said. `sent_via_instance` differing from the line
 * itself means that message went out over the fallback while this line was down.
 */
export async function recentActivity(instance: string, limit = 8): Promise<ActivityRow[]> {
  return query<ActivityRow>(
    `
    select direction,
           chatwoot_conversation_id as "chatwootConversationId",
           sent_via_instance        as "sentViaInstance",
           created_at               as "createdAt"
    from bridge.message_map
    where instance = $1
    order by created_at desc
    limit $2
  `,
    [instance, limit],
  )
}
