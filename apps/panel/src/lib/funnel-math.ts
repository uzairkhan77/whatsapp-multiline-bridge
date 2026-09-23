// The Funnel screen's arithmetic, with nothing around it. Split from
// lib/funnel.ts, same reason as funnel-filters.ts: no 'server-only', no
// dependency on Chatwoot or `pg`, so every decision about a person's sales
// figures is tested directly rather than inferred from what a page rendered.

// enums
import { Period } from '@/enums/period'
import { FunnelSortKey, SortDir } from '@/enums/sort'

// types
import type {
  AgentFunnelRow,
  FunnelFilters,
  FunnelSort,
  FunnelTrendPoint,
  ResolvedRange,
} from '@/types/funnel'

// lib
import { addDays, dayOf, startOfDay, startOfDayContaining } from './business-time'

export type {
  AgentFunnelRow,
  FunnelFilters,
  FunnelSort,
  FunnelTrendPoint,
  ResolvedRange,
} from '@/types/funnel'

// Every day this file hands out is a business day. The arithmetic behind that
// is in business-time.ts; `dayOf` is re-exported so the reads that bucket by
// day keep importing it from here.
export { dayOf }

/**
 * The first day this screen can tell the truth about — usually the day the
 * Chatwoot account was created, since there is no history before it. Every
 * range is clamped to this floor and the screen says which dates it actually
 * used, so a "last 90 days" that only has 30 is visibly that rather than
 * quietly wrong.
 *
 * Configuration, not code: it is a different date for every deployment.
 */
export const DATA_STARTS = startOfDay(
  process.env.NEXT_PUBLIC_DATA_STARTS?.trim() || '1970-01-01',
)

/**
 * The dates counted over, as business days. Every
 * boundary is a business midnight, upper bound exclusive and never past the
 * end of today. "Yesterday" is the one preset that does not reach up to now.
 * `now` is a parameter so edge behaviour is testable without waiting for one.
 */
export function resolveRange(filters: FunnelFilters, now: Date = new Date()): ResolvedRange {
  const startOfToday = startOfDayContaining(now)
  const endOfToday = addDays(startOfToday, 1)

  let to = endOfToday
  let from: Date

  if (filters.period === Period.Custom && filters.from) {
    from = startOfDay(filters.from)
    if (filters.to) {
      const asked = startOfDay(filters.to)
      if (Number.isFinite(asked.getTime())) {
        to = new Date(Math.min(addDays(asked, 1).getTime(), endOfToday.getTime()))
      }
    }
  } else if (filters.period === Period.All) {
    from = DATA_STARTS
  } else if (filters.period === Period.Yesterday) {
    from = addDays(startOfToday, -1)
    to = startOfToday
  } else {
    const days = filters.period === Period.Today ? 1 : Number(filters.period)
    const span = Number.isFinite(days) && days > 0 ? days : 14
    from = addDays(to, -span)
  }

  // A date the user typed by hand, or a period string that is not a number.
  if (!Number.isFinite(from.getTime())) from = DATA_STARTS

  const clamped = from < DATA_STARTS
  if (clamped) from = DATA_STARTS
  // A range ending before it starts would ask Postgres for a backwards series.
  // One day keeps the chart's axis sane and the answer empty rather than wrong.
  if (to <= from) to = addDays(from, 1)

  return { from, to, clamped }
}

/**
 * The daily series the chart plots, one point per day in the range.
 */
export function buildTrend(
  conversations: { day: string; conversations: number }[],
): FunnelTrendPoint[] {
  return conversations.map((point) => ({ day: point.day, conversations: point.conversations }))
}

const comparators: Record<FunnelSortKey, (row: AgentFunnelRow) => number | string | null> = {
  [FunnelSortKey.Name]: (row) => row.name,
  [FunnelSortKey.Conversations]: (row) => row.conversations,
  [FunnelSortKey.ReplyTime]: (row) => row.avgReplySeconds,
  [FunnelSortKey.OnlineTime]: (row) => row.onlineSeconds,
}

/**
 * A row with nothing to sort on goes to the bottom whichever way the column
 * is sorted — "unknown" is not a value, small or large.
 */
export function sortAgents(agents: AgentFunnelRow[], sort: FunnelSort): AgentFunnelRow[] {
  const key = comparators[sort.key]
  const valued = agents.filter((row) => key(row) !== null)
  const unknown = agents.filter((row) => key(row) === null)
  const sorted = [...valued].sort((a, b) => {
    const av = key(a)
    const bv = key(b)
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv))
    return (av as number) - (bv as number)
  })
  return [...(sort.dir === SortDir.Desc ? sorted.reverse() : sorted), ...unknown]
}

/** One agent's row, given how many conversations they hold over the range. */
export function buildAgentRow(
  agent: { id: number | string; name: string },
  conversations: number,
): AgentFunnelRow {
  return {
    id: String(agent.id),
    name: agent.name,
    conversations,
    // Filled in afterwards from the day-by-day sources — see agentPeriodStats.
    avgReplySeconds: null,
    onlineSeconds: null,
  }
}

