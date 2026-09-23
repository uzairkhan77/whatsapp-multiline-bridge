import 'server-only'

// node
import { randomUUID } from 'node:crypto'

// enums
import { RunPlan, SourceStatus, SyncSource } from '@/enums/sync'

// types
import type { FilterClause } from '@/types/chatwoot'
import type { MirrorConversation, SourceOutcome, SyncOptions, SyncReport, SyncStateRow } from '@/types/sync'

// lib
import { filterConversations } from './chatwoot'
import { isUndefinedTable, query } from './db'
import { conversationCount } from './mirror'
import {
  PAGE_SIZE,
  filterDayFor,
  floorFor,
  isLastPage,
  pageIsPastWatermark,
  pagesFor,
  planRun,
  stopBefore,
  toMirrorConversation,
} from './sync-math'

// SyncReport is re-exported: lib/funnel.ts still imports its own copy from here.
export type { SyncReport } from '@/types/sync'

// Keeping the Funnel's copy up to date, on page load — no scheduler; a
// refresh of the screen refreshes the data. It is time-boxed and never
// throws, so a failure here is a line of text, not a blank screen. A lease
// row in bridge.sync_state, taken with one UPDATE, stops two refreshes
// syncing at once, fenced on the lease token so an expired worker cannot move
// anything. Conversations walk pages incrementally until reaching rows the
// previous run already held — explained in sync-math.ts.

/** Chatwoot has answered a page in two seconds; ten means it is not going to. */
const PAGE_TIMEOUT_MS = 10_000

/** Long enough for the slowest run a button can start; short enough that a dead worker frees it soon. */
const LEASE_SECONDS = 90

/**
 * Bring the copy up to date as far as the budget allows. Never throws.
 */
export async function syncFunnelSources(options: SyncOptions = {}): Promise<SyncReport> {
  const { force = false, pageBudget = 3, budgetMs = 8_000 } = options

  const before = await readSyncState()
  if (!before) {
    const unavailable: SourceOutcome = { status: SourceStatus.Unavailable }
    return { conversations: unavailable, asOf: null, state: null }
  }

  const conversations = await guard(SyncSource.Conversations, () =>
    syncConversations(before.get(SyncSource.Conversations), { force, pageBudget, budgetMs }),
  )

  // The rows as this run left them, without reading them again: what the
  // outcome changed is known here, and a second read is another round trip.
  const state = new Map(before)
  patch(state, SyncSource.Conversations, conversations)
  return { conversations, asOf: asOfFrom(state), state }
}

/** The state rows, or null when the tables are not there yet. */
export async function readSyncState(): Promise<Map<SyncSource, SyncStateRow> | null> {
  try {
    const rows = await query<StateDbRow>(`select * from bridge.sync_state`)
    return new Map(rows.map((row) => [row.source, fromDb(row)]))
  } catch (error) {
    if (isUndefinedTable(error)) return null
    throw error
  }
}

/**
 * Start a walk from the first page, keeping the rows already held. For a copy
 * that has fallen short of Chatwoot — a deletion there is invisible to an
 * incremental run. Rows untouched by the walk and quiet since it began are
 * removed when it ends, so the copy converges on the source.
 */
export async function requestRebuild(): Promise<void> {
  await query(
    `update bridge.sync_state
        set walk_page = 1, walk_started_at = now(), walk_since = null
      where source = 'conversations'
        and (lease_until is null or lease_until < now())`,
  )
}

function patch(state: Map<SyncSource, SyncStateRow>, source: SyncSource, outcome: SourceOutcome): void {
  const row = state.get(source)
  if (!row) return
  if (outcome.status === SourceStatus.Ok) {
    state.set(source, {
      ...row,
      lastOkAt: outcome.lastOkAt ?? row.lastOkAt,
      lastError: null,
      lastRows: outcome.rows ?? row.lastRows,
      walkPage: null,
      walkStartedAt: null,
      walkSince: null,
    })
  } else if (outcome.status === SourceStatus.Partial && outcome.walk) {
    state.set(source, { ...row, walkPage: outcome.walk.page })
  } else if (outcome.status === SourceStatus.Failed) {
    state.set(source, { ...row, lastError: outcome.detail ?? row.lastError })
  }
}

function asOfFrom(state: Map<SyncSource, SyncStateRow>): Date | null {
  return state.get(SyncSource.Conversations)?.lastOkAt ?? null
}

async function guard(source: SyncSource, run: () => Promise<SourceOutcome>): Promise<SourceOutcome> {
  try {
    return await run()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn(`[panel] ${source} sync failed:`, detail)
    return { status: SourceStatus.Failed, detail }
  }
}

// --- the lease ---------------------------------------------------------------

/**
 * Claim the source for this run, or learn that another refresh has it. One
 * statement decides on the database's own clock: free lease, past the floor
 * and any failure backoff, unless forced. For conversations the same
 * statement opens the walk when none is open, at page one; an in-progress
 * walk keeps its cursor.
 */
async function acquireLease(
  source: SyncSource,
  force: boolean,
  walkSince: string | null = null,
): Promise<{ token: string; state: SyncStateRow } | null> {
  const token = randomUUID()
  const rows = await query<StateDbRow>(
    `update bridge.sync_state
        set lease_token     = $2,
            lease_until     = now() + ($4::int * interval '1 second'),
            last_run_at     = now(),
            walk_page       = case when source = 'conversations' and walk_page is null then 1     else walk_page       end,
            walk_started_at = case when source = 'conversations' and walk_page is null then now() else walk_started_at end,
            walk_since      = case when source = 'conversations' and walk_page is null then $6::date else walk_since   end
      where source = $1
        and (lease_until is null or lease_until < now())
        and ($3::boolean or last_run_at is null or last_run_at < now() - ($5::int * interval '1 second'))
        and ($3::boolean or last_error is null or last_run_at is null or last_run_at < now() - interval '2 minutes')
      returning *`,
    [source, token, force, LEASE_SECONDS, Math.round(floorFor() / 1000), walkSince],
  )
  return rows[0] ? { token, state: fromDb(rows[0]) } : null
}

async function releaseLease(source: SyncSource, token: string): Promise<void> {
  await query(
    `update bridge.sync_state
        set lease_until = null, lease_token = null
      where source = $1 and lease_token = $2`,
    [source, token],
  )
}

async function failRun(source: SyncSource, token: string, detail: string): Promise<void> {
  await query(
    `update bridge.sync_state
        set last_error = $3, lease_until = null, lease_token = null
      where source = $1 and lease_token = $2`,
    [source, token, detail.slice(0, 500)],
  )
}

// --- conversations -----------------------------------------------------------

async function syncConversations(
  state: SyncStateRow | undefined,
  options: Required<SyncOptions>,
): Promise<SourceOutcome> {
  if (!state || planRun(state, new Date(), options.force) === RunPlan.Skip) return { status: SourceStatus.Skipped }

  // A routine run is a walk too, from page one, ending where the last run
  // began — so one that runs out of budget resumes at the page it reached.
  const since = state.watermarkAt === null ? null : filterDayFor(state.watermarkAt)
  const lease = await acquireLease(SyncSource.Conversations, options.force, since)
  if (!lease) return { status: SourceStatus.Busy }

  try {
    return await walk(lease.state, lease.token, options.pageBudget, Date.now() + options.budgetMs)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await failRun(SyncSource.Conversations, lease.token, detail).catch(() => {})
    return { status: SourceStatus.Failed, detail }
  }
}

/**
 * Read pages from the saved cursor until the end, the watermark, or the
 * budget. Each page's rows and its progress land in one statement, so a run
 * cut off mid-page resumes at that page. Rows only move *towards* page one as
 * they get activity, so a page read twice is a duplicate upsert, never a gap.
 */
async function walk(
  state: SyncStateRow,
  token: string,
  pageBudget: number,
  deadline: number,
): Promise<SourceOutcome> {
  const startedAt = state.walkStartedAt ?? new Date()
  const fromStart = state.walkSince === null
  const clauses: FilterClause[] = [
    { attribute_key: 'last_activity_at', filter_operator: 'is_greater_than', values: [state.walkSince ?? '2000-01-01'] },
  ]
  // Only a run with a watermark can stop early; the first fill reads everything.
  const stopAt = !fromStart && state.watermarkAt ? stopBefore(state.watermarkAt) : null

  let page = state.walkPage ?? 1
  let allCount = state.sourceTotal ?? 0
  let written = 0

  for (let used = 0; used < pageBudget && Date.now() < deadline; used += 1) {
    const { allCount: total, payload } = await filterConversations(clauses, page, AbortSignal.timeout(PAGE_TIMEOUT_MS))
    allCount = total
    const rows = payload.map(toMirrorConversation).filter((row): row is MirrorConversation => row !== null)
    written += rows.length

    const done = isLastPage(page, payload.length, total) || (stopAt !== null && pageIsPastWatermark(rows, stopAt))
    if (done) return finishWalk(token, rows, startedAt, fromStart, total, written)

    page += 1
    // Only a walk from the beginning knows the real total; an incremental
    // one's count is a few days' activity, and is not written over it.
    const alive = await writePage(token, rows, page, fromStart ? total : null)
    if (!alive) return { status: SourceStatus.Failed, detail: 'another refresh took over the sync' }
  }

  await releaseLease(SyncSource.Conversations, token)
  return { status: SourceStatus.Partial, rows: written, walk: { page, pages: pagesFor(allCount), fromStart } }
}

/**
 * The rows in, newest activity wins. The guard on the update makes two
 * workers on the same page harmless: the second write cannot overwrite a
 * newer reading with an older one.
 */
const UPSERT_ROWS = `
  insert into bridge.conversations
    (id, inbox_id, status, created_at, last_activity_at, assignee_id, assignee_email, synced_at)
  select id, inbox_id, status, created_at, last_activity_at, assignee_id, assignee_email, now()
    from unnest($1::bigint[], $2::int[], $3::text[], $4::timestamptz[], $5::timestamptz[], $6::int[], $7::text[])
           as t(id, inbox_id, status, created_at, last_activity_at, assignee_id, assignee_email)
  on conflict (id) do update
     set inbox_id         = excluded.inbox_id,
         status           = excluded.status,
         created_at       = excluded.created_at,
         last_activity_at = excluded.last_activity_at,
         assignee_id      = excluded.assignee_id,
         assignee_email   = excluded.assignee_email,
         synced_at        = excluded.synced_at
   where bridge.conversations.last_activity_at is null
      or excluded.last_activity_at is null
      or excluded.last_activity_at >= bridge.conversations.last_activity_at
  returning id`

function columns(rows: MirrorConversation[]): unknown[] {
  return [
    rows.map((row) => row.id),
    rows.map((row) => row.inboxId),
    rows.map((row) => row.status),
    rows.map((row) => row.createdAt),
    rows.map((row) => row.lastActivityAt),
    rows.map((row) => row.assigneeId),
    rows.map((row) => row.assigneeEmail),
  ]
}

/** A page's rows and the cursor past it, in one statement that also renews the lease. */
async function writePage(
  token: string,
  rows: MirrorConversation[],
  nextPage: number,
  sourceTotal: number | null,
): Promise<boolean> {
  const done = await query<{ source: string }>(
    `with up as (${UPSERT_ROWS})
     update bridge.sync_state
        set walk_page    = greatest(coalesce(walk_page, 1), $9),
            source_total = coalesce($10, source_total),
            lease_until  = now() + ($11::int * interval '1 second')
      where source = 'conversations' and lease_token = $8
      returning source`,
    [...columns(rows), token, nextPage, sourceTotal, LEASE_SECONDS],
  )
  return done.length > 0
}

/**
 * The last page's rows and the run's completion, in one statement. A walk
 * from the beginning also removes what it never met — quiet since it began,
 * so gone from Chatwoot. An incremental walk never touches this, since it
 * never meets the quiet majority. This statement's own rows are excluded
 * from the delete, so the two never contend.
 */
async function finishWalk(
  token: string,
  rows: MirrorConversation[],
  startedAt: Date,
  fromStart: boolean,
  sourceTotal: number,
  written: number,
): Promise<SourceOutcome> {
  const stale = fromStart
    ? `, stale as (
         delete from bridge.conversations
          where synced_at < $9
            and (last_activity_at is null or last_activity_at < $9)
            and id <> all($1::bigint[])
       )`
    : ''
  const done = await query<{ lastOkAt: Date }>(
    `with up as (${UPSERT_ROWS})${stale}
     update bridge.sync_state
        set walk_page = null, walk_started_at = null, walk_since = null,
            watermark_at = $9, source_total = coalesce($10, source_total),
            last_ok_at = now(), last_rows = $11, last_error = null,
            lease_until = null, lease_token = null
      where source = 'conversations' and lease_token = $8
      returning last_ok_at as "lastOkAt"`,
    [...columns(rows), token, startedAt, fromStart ? sourceTotal : null, written],
  )
  if (done.length === 0) return { status: SourceStatus.Failed, detail: 'another refresh took over the sync' }

  // A full read short by more than a page is said, not repaired here: a
  // self-restarting walk on an unreachable count would re-read every page on
  // every refresh. A person reads the notice and clicks Rebuild instead.
  let detail: string | undefined
  if (fromStart) {
    const held = await conversationCount()
    if (held < sourceTotal - PAGE_SIZE) {
      detail = `some conversations are missing here — ${held} loaded, Chatwoot has ${sourceTotal}`
    }
  }
  return { status: SourceStatus.Ok, rows: written, detail, lastOkAt: done[0]!.lastOkAt }
}

// --- rows --------------------------------------------------------------------

interface StateDbRow {
  source: SyncSource
  watermark_at: Date | null
  walk_page: number | null
  walk_started_at: Date | null
  walk_since: Date | string | null
  source_total: number | null
  lease_token: string | null
  lease_until: Date | null
  last_run_at: Date | null
  last_ok_at: Date | null
  last_rows: number | null
  last_error: string | null
}

function fromDb(row: StateDbRow): SyncStateRow {
  // `date` columns come back as a Date at local midnight; the walk wants the
  // same YYYY-MM-DD text it was given, whatever the server's zone.
  const since =
    row.walk_since === null
      ? null
      : row.walk_since instanceof Date
        ? `${row.walk_since.getFullYear()}-${String(row.walk_since.getMonth() + 1).padStart(2, '0')}-${String(row.walk_since.getDate()).padStart(2, '0')}`
        : String(row.walk_since).slice(0, 10)
  return {
    source: row.source,
    watermarkAt: row.watermark_at,
    walkPage: row.walk_page,
    walkStartedAt: row.walk_started_at,
    walkSince: since,
    sourceTotal: row.source_total,
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until,
    lastRunAt: row.last_run_at,
    lastOkAt: row.last_ok_at,
    lastRows: row.last_rows,
    lastError: row.last_error,
  }
}
