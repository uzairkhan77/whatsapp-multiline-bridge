// The two day-by-day tables under the Funnel's agent table — response time and
// Online time — one row per business day and one column per agent.
// No 'server-only' import and no I/O, like funnel-math.ts: everything here is
// arithmetic over rows somebody else fetched, so it runs under node:test.

// types
import type {
  AgentDays,
  AgentPeriodStats,
  AgentSeriesPoint,
  DailyReplyTime,
  OnlineTotal,
  PresenceByDay,
  PresenceInterval,
  SecondsByAgentDay,
} from '@/types/agent-days'

// lib
import { dayOf, nextMidnight, startOfDay, startOfDayContaining } from './business-time'

export type {
  AgentDays,
  AgentPeriodStats,
  AgentSeriesPoint,
  DailyReplyTime,
  OnlineTotal,
  PresenceByDay,
  PresenceInterval,
  SecondsByAgentDay,
} from '@/types/agent-days'

const DAY_MS = 86_400_000

/** Every business day in [from, to), newest first — the rows of both tables. */
export function listDays(from: Date, to: Date): string[] {
  const days: string[] = []
  const first = startOfDayContaining(from).getTime()
  for (let at = first; at < to.getTime(); at += DAY_MS) days.push(dayOf(new Date(at)))
  return days.reverse()
}

// --- Online time, from the bridge's presence record ---------------------------

function add(into: SecondsByAgentDay, agentId: number, day: string, seconds: number): void {
  const byDay = (into[agentId] ??= {})
  byDay[day] = (byDay[day] ?? 0) + seconds
}

/**
 * Clip every stretch to [from, to), cut it at each business midnight, and add
 * what is left to that agent's day. Only Online and Busy add seconds; every
 * status marks the day as recorded. A zero-length stretch marks nothing.
 */
export function bucketPresence(rows: PresenceInterval[], from: Date, to: Date): PresenceByDay {
  const out: PresenceByDay = { online: {}, busy: {}, recorded: {} }

  for (const row of rows) {
    const start = Math.max(new Date(row.sinceAt).getTime(), from.getTime())
    const end = Math.min(new Date(row.seenAt).getTime(), to.getTime())
    // Also false for NaN, so a malformed timestamp is skipped rather than summed.
    if (!(end > start)) continue

    let cursor = start
    while (cursor < end) {
      const next = Math.min(end, nextMidnight(cursor))
      const day = dayOf(new Date(cursor))
      ;(out.recorded[row.agentId] ??= {})[day] = true
      const seconds = (next - cursor) / 1000
      if (row.status === 'online') add(out.online, row.agentId, day, seconds)
      else if (row.status === 'busy') add(out.busy, row.agentId, day, seconds)
      cursor = next
    }
  }

  return out
}

// --- Response time, from Chatwoot's reports -----------------------------------

/**
 * Chatwoot's per-agent series → one entry per day inside [from, to). Zero
 * becomes null: Chatwoot fills a no-reply day with 0, which would misread as
 * "instant". Days outside the range are dropped rather than trusted. The
 * report is asked in the business offset, so `dayOf` names the right day.
 */
export function parseReplySeries(raw: unknown, from: Date, to: Date): DailyReplyTime[] {
  if (!Array.isArray(raw)) return []
  const first = dayOf(from)
  const last = dayOf(to)
  const out: DailyReplyTime[] = []
  for (const point of raw as { timestamp?: unknown; value?: unknown }[]) {
    if (typeof point?.timestamp !== 'number') continue
    const day = dayOf(new Date(point.timestamp * 1000))
    if (day < first || day >= last) continue
    const seconds = Number(point.value)
    out.push({ day, seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null })
  }
  return out
}

/** The series per agent → agent id → day → seconds. A day the series does not mention is absent. */
export function replyByDay(series: Map<number, DailyReplyTime[]>): Record<string, Record<string, number | null>> {
  const out: Record<string, Record<string, number | null>> = {}
  for (const [agentId, points] of series) {
    out[agentId] = Object.fromEntries(points.map((point) => [point.day, point.seconds]))
  }
  return out
}

// --- what the screen renders --------------------------------------------------

/** The response-time series: average seconds per agent per day, null where they sent no reply. */
export function replySeries(view: AgentDays): AgentSeriesPoint[] {
  const { reply } = view
  return [...view.days].reverse().map((day) => {
    const point: AgentSeriesPoint = { day }
    for (const agent of view.agents) {
      point[String(agent.id)] =
        !reply || reply.missing.includes(agent.id) ? null : (reply.seconds[agent.id]?.[day] ?? null)
    }
    return point
  })
}

/** Period totals per agent, in roster order, for the bar per agent. */
export function onlineTotals(view: AgentDays): OnlineTotal[] {
  const { presence } = view
  return view.agents.map((agent) => {
    const days = presence?.recorded[agent.id] ?? {}
    const sum = (by: Record<string, number> | undefined) => Object.values(by ?? {}).reduce((a, b) => a + b, 0)
    return {
      id: agent.id,
      name: agent.name,
      online: sum(presence?.online[agent.id]),
      busy: sum(presence?.busy[agent.id]),
      recordedDays: Object.keys(days).length,
    }
  })
}

/**
 * Each agent's reply time and Online time over the whole period, for the
 * By-agent table. Reply time is the mean of the daily averages, the same
 * figure as the chart's legend. Null where there is nothing to compute from.
 */
export function agentPeriodStats(view: AgentDays | null): Record<string, AgentPeriodStats> {
  const out: Record<string, AgentPeriodStats> = {}
  if (!view) return out
  const totals = new Map(onlineTotals(view).map((row) => [row.id, row]))
  for (const agent of view.agents) {
    const reply = view.reply
    const days = reply && !reply.missing.includes(agent.id) ? Object.values(reply.seconds[agent.id] ?? {}) : []
    const replied = days.filter((value): value is number => typeof value === 'number')
    const total = totals.get(agent.id)
    out[agent.id] = {
      avgReplySeconds: replied.length > 0 ? replied.reduce((sum, value) => sum + value, 0) / replied.length : null,
      onlineSeconds: total && total.recordedDays > 0 ? total.online : null,
    }
  }
  return out
}

// --- the reply-time axis --------------------------------------------------------

/**
 * The rungs a logarithmic reply-time axis may land on, in seconds: values a
 * reader recognises, spaced so that each is two to three times the last.
 */
const LADDER = [10, 30, 60, 120, 300, 900, 1800, 3600, 7200, 4 * 3600, 8 * 3600, 24 * 3600, 48 * 3600, 7 * 86_400]

/**
 * Where a log axis runs from and to, and its ticks, for readings between `min`
 * and `max` seconds — floor and ceiling are the nearest rungs enclosing every
 * point, thinned to seven ticks or fewer. Always at least two rungs apart.
 */
export function replyAxis(min: number, max: number): { floor: number; ceil: number; ticks: number[] } {
  const lo = Math.max(LADDER[0]!, Math.min(min, max))
  const hi = Math.max(lo, max)
  let floorIndex = 0
  while (floorIndex + 1 < LADDER.length && LADDER[floorIndex + 1]! <= lo) floorIndex += 1
  let ceilIndex = floorIndex + 1
  while (ceilIndex < LADDER.length - 1 && LADDER[ceilIndex]! < hi) ceilIndex += 1
  let ticks = LADDER.slice(floorIndex, ceilIndex + 1)
  while (ticks.length > 7) ticks = ticks.filter((_, index) => index % 2 === 0 || index === ticks.length - 1)
  return { floor: LADDER[floorIndex]!, ceil: LADDER[ceilIndex]!, ticks }
}

/** "30s", "5m", "1h", "24h" — a rung of the ladder above, which is always a whole unit. */
export function rungLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

// --- sample readings, for a screen with nothing real to show yet --------------

const HOUR_MS = 3_600_000

/**
 * Made-up presence for local testing, until the real record has a few days in
 * it. Deterministic so the chart looks the same on every reload; the third day
 * of the period has no readings, so "not recorded" shows too. Nothing runs
 * past `now`. Only reached behind the FUNNEL_MOCK_ONLINE flag in lib/funnel.ts,
 * never in a production build.
 */
export function samplePresence(agents: { id: number }[], from: Date, to: Date, now = new Date()): PresenceInterval[] {
  const rows: PresenceInterval[] = []
  const days = listDays(from, to).reverse()
  days.forEach((day, k) => {
    if (k === 2) return
    const midnight = startOfDay(day).getTime()
    agents.forEach((agent, i) => {
      if ((k + i) % 7 === 5) return
      const start = midnight + 7 * HOUR_MS + i * 0.25 * HOUR_MS
      const busyAt = start + (3 + (i % 3)) * HOUR_MS
      const busyFor = (0.5 + (k % 3) * 0.25) * HOUR_MS
      const end = start + (7 + ((k + i) % 4) * 0.5) * HOUR_MS
      const clip = (ms: number) => new Date(Math.min(ms, now.getTime()))
      if (start >= now.getTime()) return
      rows.push({ agentId: agent.id, status: 'online', sinceAt: new Date(start), seenAt: clip(busyAt) })
      if (busyAt < now.getTime()) {
        rows.push({ agentId: agent.id, status: 'busy', sinceAt: new Date(busyAt), seenAt: clip(busyAt + busyFor) })
      }
      if (busyAt + busyFor < now.getTime()) {
        rows.push({ agentId: agent.id, status: 'online', sinceAt: new Date(busyAt + busyFor), seenAt: clip(end) })
      }
    })
  })
  return rows
}
