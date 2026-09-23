import 'server-only'

// lib
import { BUSINESS_TIMEZONE, dayOf } from './business-time'
import { isUndefinedTable, query } from './db'

// The Funnel's reads, answered from our own copy of Chatwoot's conversations
// in bridge.conversations, kept up to date by lib/sync.ts. Every query is a
// GROUP BY over a few thousand rows and answers in milliseconds, so none of it
// is memoised — `remember()` is for slower HTTP calls.

/** The tables are not there: the bridge has not deployed this schema yet. */
export class MirrorUnavailable extends Error {
  constructor() {
    super('The funnel tables have not been created yet — the bridge needs a deploy')
    this.name = 'MirrorUnavailable'
  }
}

async function read<T>(text: string, values: unknown[] = []): Promise<T[]> {
  try {
    return await query<T>(text, values)
  } catch (error) {
    if (isUndefinedTable(error)) throw new MirrorUnavailable()
    throw error
  }
}

/**
 * Whether the copy can answer the screen: the first fill of conversation
 * history has completed at least once. A rebuild in progress still answers.
 */
export async function mirrorReady(): Promise<boolean> {
  try {
    const rows = await read<{ ready: boolean }>(
      `select watermark_at is not null as "ready"
         from bridge.sync_state
        where source = 'conversations'`,
    )
    return rows[0]?.ready ?? false
  } catch (error) {
    if (error instanceof MirrorUnavailable) return false
    throw error
  }
}

/**
 * Conversations opened in the range, per agent who currently holds them —
 * `assignee_id` as it stands now, `created_at` inside the range. A conversation
 * moved to another agent counts for whoever has it now.
 */
export async function agentConversationCounts(
  from: Date,
  to: Date,
  inboxId?: number,
): Promise<Map<number, number>> {
  const rows = await read<{ assigneeId: number; conversations: number }>(
    `select assignee_id as "assigneeId", count(*)::int as "conversations"
       from bridge.conversations
      where created_at >= $1
        and created_at <  $2
        and assignee_id is not null
        and ($3::int is null or inbox_id = $3)
      group by assignee_id`,
    [from, to, inboxId ?? null],
  )
  return new Map(rows.map((row) => [row.assigneeId, row.conversations]))
}

/**
 * Conversations opened per day across the account — assigned or not, since an
 * unpicked-up conversation still happened. Zero-filled and bucketed in the
 * business timezone, the same days `resolveRange` hands out.
 */
export async function dailyConversations(
  from: Date,
  to: Date,
  inboxId?: number,
): Promise<{ day: string; conversations: number }[]> {
  return read<{ day: string; conversations: number }>(
    `with span as (
       select generate_series($3::date, ($4::date - interval '1 day')::date, interval '1 day')::date as day
     ),
     counted as (
       select (created_at at time zone $6)::date as day, count(*)::int as n
         from bridge.conversations
        where created_at >= $1
          and created_at <  $2
          and ($5::int is null or inbox_id = $5)
        group by 1
     )
     select to_char(span.day, 'YYYY-MM-DD') as "day",
            coalesce(counted.n, 0)          as "conversations"
       from span
       left join counted on counted.day = span.day
      order by span.day`,
    [from, to, dayOf(from), dayOf(to), inboxId ?? null, BUSINESS_TIMEZONE],
  )
}

/** How many conversations the copy holds, for the sync status line on Settings. */
export async function conversationCount(): Promise<number> {
  const rows = await read<{ count: number }>(
    `select count(*)::int as "count" from bridge.conversations`,
  )
  return rows[0]?.count ?? 0
}
