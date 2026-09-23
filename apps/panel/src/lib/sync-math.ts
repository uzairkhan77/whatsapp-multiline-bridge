// The decisions behind the Funnel's copy of Chatwoot. Same split, same reason,
// as funnel-math.ts: no 'server-only', no `pg`, no HTTP, so each rule — which
// page to ask for, when to stop walking — is testable on its own.

// enums
import { RunPlan, SyncSource } from '@/enums/sync'

// types
import type { MirrorConversation, SyncStateRow } from '@/types/sync'

// Re-exported: lib/sync-math.test.ts imports its own copy from this file.
export type { SyncStateRow } from '@/types/sync'

/**
 * YYYY-MM-DD in UTC — Chatwoot's clock, not the business's. Handed to
 * Chatwoot's filter, which reads it on its own clock; the Funnel's the business timezone
 * days (lib/business-time.ts) are for the screen and do not belong here.
 */
function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/** Chatwoot's page size on the conversation filter endpoint. Not configurable. */
export const PAGE_SIZE = 25

/**
 * How far behind the watermark an incremental run asks Chatwoot to look. Two
 * days, when one would do if Chatwoot's date filter were provably UTC. The
 * extra margin costs nothing: `pageIsPastWatermark` stops the run early anyway.
 */
export const INCREMENTAL_MARGIN_DAYS = 2

/** How far past the watermark a run keeps reading before trusting it holds the rest. */
export const STOP_OVERLAP_MS = 10 * 60_000

/** A refresh within this of the last attempt does not sync again. */
export const RUN_FLOOR_MS = 30_000

/**
 * After a failed run, wait this long before trying again. Keyed on the
 * attempt, not the last success, so an hour-long Chatwoot outage does not add
 * its timeout to every page load in that hour.
 */
export const ERROR_BACKOFF_MS = 2 * 60_000

/**
 * The date to hand Chatwoot's `is_greater_than` so everything active on or
 * after `watermarkAt − marginDays` comes back. Chatwoot reads the filter as
 * "after that whole day ended", so a naive date silently drops that day —
 * measured as `> 2026-09-03` returning 1,016 conversations against 979 for
 * `> 2026-09-04`. It cost one agent their entire conversation count the first
 * time round. Hence one more day off.
 */
export function filterDayFor(watermarkAt: Date, marginDays = INCREMENTAL_MARGIN_DAYS): string {
  return utcDay(new Date(watermarkAt.getTime() - (marginDays + 1) * 86_400_000))
}

/** The instant before which a run may assume it already holds every row. */
export function stopBefore(watermarkAt: Date, overlapMs = STOP_OVERLAP_MS): Date {
  return new Date(watermarkAt.getTime() - overlapMs)
}

/**
 * Whether a page has reached rows the copy already holds. The filter answers
 * newest activity first, so once a page's oldest row predates the stop
 * instant, every later page was read by an earlier run — this is what keeps a
 * routine run at one page. An empty page is past by definition; a row with no
 * timestamp reads as unknown ("keep going"), with `isLastPage` bounding the walk.
 */
export function pageIsPastWatermark(
  rows: { lastActivityAt: Date | null }[],
  stopAt: Date,
): boolean {
  if (rows.length === 0) return true
  const oldest = rows[rows.length - 1]!.lastActivityAt
  return oldest !== null && oldest.getTime() < stopAt.getTime()
}

/**
 * Whether this page was the last one. A short page always is; a full page is
 * when the total count says nothing follows it — including when that count
 * has shrunk below the pages already read, i.e. a deletion mid-walk.
 */
export function isLastPage(page: number, payloadLength: number, allCount: number, perPage = PAGE_SIZE): boolean {
  if (payloadLength < perPage) return true
  return page * perPage >= allCount
}

/** How many pages a filter that matches `allCount` rows has. */
export function pagesFor(allCount: number, perPage = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(allCount / perPage))
}

/** How long a refresh leaves a source alone after the last attempt on it. */
export function floorFor(): number {
  return RUN_FLOOR_MS
}

/**
 * What a refresh should do for one source. `skip` within the floor of the
 * last attempt or a failed one's backoff; `force` overrides both. `walk`
 * (conversations only) means reading pages from a saved cursor — a walk in
 * progress, or the first fill. Otherwise `run`.
 */
export function planRun(state: SyncStateRow | undefined, now: Date, force = false): RunPlan {
  if (!state) return RunPlan.Skip

  if (!force && state.lastRunAt) {
    const since = now.getTime() - state.lastRunAt.getTime()
    if (since < floorFor()) return RunPlan.Skip
    if (state.lastError && since < ERROR_BACKOFF_MS) return RunPlan.Skip
  }

  if (state.source === SyncSource.Conversations && (state.walkPage !== null || state.watermarkAt === null)) {
    return RunPlan.Walk
  }
  return RunPlan.Run
}

function unixToDate(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Date(value * 1000)
}

/**
 * A conversation from the filter endpoint's payload, or null when it is not
 * one. Only the fields the Funnel counts on; `created_at` and
 * `last_activity_at` arrive as unix seconds. Anything without a numeric id or
 * readable creation time is dropped rather than stored with a guess.
 */
export function toMirrorConversation(raw: unknown): MirrorConversation | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>

  const id = row.id
  if (typeof id !== 'number' || !Number.isInteger(id)) return null
  const createdAt = unixToDate(row.created_at)
  if (!createdAt) return null

  const meta = (row.meta ?? {}) as Record<string, unknown>
  const assignee = (meta.assignee ?? null) as Record<string, unknown> | null
  const assigneeId = assignee && typeof assignee.id === 'number' ? assignee.id : null
  const email = assignee && typeof assignee.email === 'string' ? assignee.email.trim().toLowerCase() : ''

  return {
    id,
    inboxId: typeof row.inbox_id === 'number' ? row.inbox_id : null,
    status: typeof row.status === 'string' ? row.status : null,
    createdAt,
    lastActivityAt: unixToDate(row.last_activity_at),
    assigneeId,
    assigneeEmail: email || null,
  }
}
