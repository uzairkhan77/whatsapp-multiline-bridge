import 'server-only'

// enums
import { FunnelSource } from '@/enums/funnel-source'
import { SourceStatus, SyncSource } from '@/enums/sync'

// types
import type { AgentDays, DailyReplyTime, PresenceInterval } from '@/types/agent-days'
import type { Funnel, FunnelFilters, FunnelSort, FunnelSummary } from '@/types/funnel'

// lib
import { agentPeriodStats, bucketPresence, listDays, replyByDay, samplePresence } from './agent-days'
import { agentRoster } from './agents'
import { agentConversationCount, dailyConversations as liveDailyConversations, dailyReplyTime } from './chatwoot'
import { DATA_STARTS, buildAgentRow, buildTrend, dayOf, resolveRange, sortAgents } from './funnel-math'
import { configuredLines } from './lines'
import * as mirror from './mirror'
import { PresenceUnavailable, presenceIntervals, presenceRecordedSince } from './presence'
import { syncFunnelSources, type SyncReport } from './sync'
import { pagesFor } from './sync-math'

// What the team handled, and how quickly. Conversations per agent, reply
// times and Online time, over one range. Two ways of reading, side by side
// via `?source=`: the copy in our own database (lib/mirror.ts), and live
// reads straight from Chatwoot.

export { PERIOD_PRESETS } from './funnel-filters'
export { DATA_STARTS }
export type { AgentFunnelRow, Funnel, FunnelFilters, FunnelSort, FunnelSummary, FunnelTrendPoint } from '@/types/funnel'
export type { AgentDays } from '@/types/agent-days'

/** The source a page uses when the URL does not say. Flipped by deploy, not by code. */
export function defaultFunnelSource(): FunnelSource {
  return process.env.FUNNEL_SOURCE?.trim().toLowerCase() === FunnelSource.Mirror ? FunnelSource.Mirror : FunnelSource.Chatwoot
}

/**
 * One read over one range. Every source is settled rather than awaited in
 * turn, so one slow database degrades a section instead of blanking the page
 * — named in `degraded`. The copy is refreshed first, inside its own budget,
 * whichever source the figures then come from.
 */
export async function loadFunnel(
  filters: FunnelFilters,
  sort: FunnelSort,
  source: FunnelSource = defaultFunnelSource(),
): Promise<Funnel> {
  const degraded: string[] = []
  const { from, to, clamped } = resolveRange(filters)

  const [[agentsResult, linesResult], sync] = await Promise.all([
    Promise.allSettled([agentRoster(), configuredLines()]),
    syncFunnelSources(),
  ])

  // The roster comes from bridge.chatwoot_agents, refreshed when older than
  // five minutes rather than hit on every render — an in-process memo would
  // be thrown away on every Vercel cold start, and a roster held in our own
  // database still names people when Chatwoot is away. `agentRoster` answers
  // empty rather than throwing on an unreadable roster; a rejection here
  // means only that our own database is unreachable.
  const roster = agentsResult.status === 'fulfilled' ? agentsResult.value.agents : []
  if (agentsResult.status !== 'fulfilled' || agentsResult.value.empty) {
    degraded.push('The agent list could not be read, so no agents are shown below')
  }

  const lines = linesResult.status === 'fulfilled' ? linesResult.value : []
  if (linesResult.status === 'rejected') degraded.push('The line list could not be read')

  // The copy answers only once it has been filled at least once; until then, and
  // when it is not there at all, the live reads do — said on the page, so a
  // person asking for the copy is never quietly shown something else.
  const history = historyOf(sync)
  let usingMirror = source === FunnelSource.Mirror
  if (usingMirror) {
    const ready = sync.state !== null && (await mirror.mirrorReady())
    if (!ready) {
      usingMirror = false
      // Why the copy is not answering is for the log; the screen only needs
      // to know the figures are complete, which the live reads make them.
      console.warn(
        '[panel] funnel copy not ready:',
        sync.state === null ? 'bridge.sync_state is missing — the bridge needs a deploy' : 'first fill has not finished',
      )
      if (sync.state !== null) degraded.push('Conversation history is still loading in the background')
    }
  }

  degraded.push(...syncNotices(sync, usingMirror))

  const asOf = sync.asOf?.toISOString() ?? null
  const actual: FunnelSource = usingMirror ? FunnelSource.Mirror : FunnelSource.Chatwoot

  // Which line was asked for, and can it be honoured. A filter that cannot be
  // resolved must not quietly fall back to every line — that was a real past
  // failure — so an unresolvable line returns an empty screen that says why.
  const wanted = filters.instance?.trim()
  const selected = wanted ? lines.find((line) => line.instance === wanted) : undefined

  if (wanted && !selected) {
    degraded.push(
      linesResult.status === 'rejected'
        ? `The line list could not be read, so nothing could be filtered to ${wanted} — no figures are shown rather than every line's`
        : `No line called ${wanted} is configured, so there is nothing to show for it`,
    )
    return empty(lines, degraded, { from, to, clamped }, actual, asOf, history)
  }

  if (selected && selected.chatwootInboxId === null) {
    degraded.push(
      `${selected.instance} has no Chatwoot inbox attached, so it has no conversations and nothing can be attributed to it`,
    )
    return empty(lines, degraded, { from, to, clamped }, actual, asOf, history)
  }

  const inboxId = selected?.chatwootInboxId ?? undefined

  const [counts, trendConversations, replies, presenceRead] = await Promise.all([
    usingMirror
      ? settled(() => mirror.agentConversationCounts(from, to, inboxId)).then((map) => ({
          byAgent: map ?? new Map<number, number>(),
          incomplete: map === null,
        }))
      : liveAgentCounts(roster.map((agent) => agent.id), from, to, inboxId),
    settled(() => (usingMirror ? mirror.dailyConversations(from, to, inboxId) : liveDailyConversations(from, to, inboxId))),
    // The two day-by-day tables read the same way regardless of source:
    // Chatwoot's reports are the only place reply time exists.
    Promise.allSettled(roster.map((agent) => dailyReplyTime(agent.id, from, to))),
    readPresence(from, to, roster),
  ])

  if (counts.incomplete) degraded.push('Some conversation counts could not be read')
  if (trendConversations === null) degraded.push('The daily conversation trend could not be read')

  const agentDays = assembleAgentDays(roster, from, to, replies, presenceRead, selected !== undefined, degraded)

  // The two period columns come from the same sources as the charts below the
  // table, so a figure in the table is the figure in the chart.
  const periodStats = agentPeriodStats(agentDays)
  const agents = roster.map((agent) => ({
    ...buildAgentRow(agent, counts.byAgent.get(agent.id) ?? 0),
    ...periodStats[agent.id],
  }))

  const conversationsAssigned = agents.reduce((sum, row) => sum + row.conversations, 0)

  // The account-wide count, larger than the agents' rows add up to since an
  // unpicked-up conversation still happened. Shown together for that reason.
  const trend = buildTrend(trendConversations ?? [])
  const conversationsStarted = trend.reduce((sum, point) => sum + point.conversations, 0)

  // Averaged over the agents who actually replied: including a zero for
  // somebody who answered nothing would drag the team's figure down for a
  // reason that has nothing to do with speed.
  const replied = agents.map((row) => row.avgReplySeconds).filter((s): s is number => s !== null)

  const summary: FunnelSummary = {
    conversationsStarted,
    conversationsAssigned,
    avgReplySeconds: replied.length > 0 ? replied.reduce((sum, s) => sum + s, 0) / replied.length : null,
  }

  return {
    agents: sortAgents(agents, sort),
    summary,
    trend,
    lines: lines.map((line) => ({ instance: line.instance })),
    degraded,
    range: { from: dayOf(from), to: dayOf(new Date(to.getTime() - 86_400_000)), clamped },
    source: actual,
    asOf,
    history,
    agentDays,
    generatedAt: new Date().toISOString(),
  }
}

// --- the two day-by-day tables ------------------------------------------------

type PresenceRead = { rows: PresenceInterval[]; since: Date | null } | 'unavailable' | 'failed'

/**
 * The presence record, or which of two ways it could not be read. The table
 * not being there is normal between a panel deploy and the next bridge
 * deploy, said differently from a read that failed.
 */
async function readPresence(from: Date, to: Date, roster: { id: number }[]): Promise<PresenceRead> {
  // Sample readings for a local screen while the real record is still days
  // short. Both the flag and a non-production build are required, so the
  // flag set anywhere by mistake changes nothing on the live panel.
  if (process.env.FUNNEL_MOCK_ONLINE === 'true' && process.env.NODE_ENV !== 'production') {
    console.warn('[panel] FUNNEL_MOCK_ONLINE is on — the Online-time chart shows sample readings')
    return { rows: samplePresence(roster, from, to), since: from }
  }
  try {
    const [rows, since] = await Promise.all([presenceIntervals(from, to), presenceRecordedSince()])
    return { rows, since }
  } catch (error) {
    if (error instanceof PresenceUnavailable) return 'unavailable'
    console.warn('[panel] presence read failed:', error instanceof Error ? error.message : error)
    return 'failed'
  }
}

/**
 * Both tables from their two sources, and what to say about whichever could
 * not answer. Neither is filtered by line — Chatwoot's per-agent report
 * cannot be scoped to an inbox — so the screen says the filter does not
 * reach these tables, rather than quietly showing every line's figures.
 */
function assembleAgentDays(
  roster: { id: number; name: string }[],
  from: Date,
  to: Date,
  replies: PromiseSettledResult<DailyReplyTime[]>[],
  presenceRead: PresenceRead,
  lineFilterIgnored: boolean,
  degraded: string[],
): AgentDays {
  const series = new Map<number, DailyReplyTime[]>()
  const missing: number[] = []
  replies.forEach((result, index) => {
    const agent = roster[index]!
    if (result.status === 'fulfilled') {
      series.set(agent.id, result.value)
    } else {
      missing.push(agent.id)
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.warn(`[panel] reply time for ${agent.name} (${agent.id}) could not be read:`, reason)
    }
  })

  let reply: AgentDays['reply'] = { seconds: replyByDay(series), missing }
  if (roster.length > 0 && missing.length === roster.length) {
    reply = null
    degraded.push('Response times could not be read from Chatwoot')
  } else if (missing.length > 0) {
    const names = roster.filter((agent) => missing.includes(agent.id)).map((agent) => agent.name).join(', ')
    degraded.push(`Response times for ${names} could not be read from Chatwoot`)
  }

  let presence: AgentDays['presence'] = null
  if (presenceRead === 'unavailable') {
    // Nothing on the screen for this — the section is simply not there yet.
    console.warn('[panel] bridge.agent_presence is missing — the bridge has not been deployed with it')
  } else if (presenceRead === 'failed') {
    degraded.push('Online time could not be read')
  } else {
    presence = {
      ...bucketPresence(presenceRead.rows, from, to),
      since: presenceRead.since ? dayOf(presenceRead.since) : null,
    }
  }

  return {
    days: listDays(from, to),
    agents: roster.map(({ id, name }) => ({ id, name })),
    reply,
    presence,
    presenceMissing: presenceRead === 'unavailable',
    lineFilterIgnored,
  }
}

// --- what the refresh has to say --------------------------------------------

/** The first fill of conversation history, if one is in progress. */
function historyOf(sync: SyncReport): Funnel['history'] {
  const walk = sync.conversations.walk
  if (walk?.fromStart) return { page: walk.page, pages: walk.pages }
  const row = sync.state?.get(SyncSource.Conversations)
  if (row && row.walkPage !== null && row.walkSince === null) {
    return { page: row.walkPage, pages: pagesFor(row.sourceTotal ?? 0) }
  }
  return null
}

/**
 * Lines for the page about the copy. A live screen only needs to know the
 * first fill is running; a copy-reading screen is told everything that bears
 * on how current its figures are.
 */
function syncNotices(sync: SyncReport, usingMirror: boolean): string[] {
  const notices: string[] = []
  const { conversations } = sync
  const stamp = (at: Date | null | undefined) => (at ? `as of ${at.toISOString().slice(11, 16)} UTC` : 'from the last complete copy')

  if (conversations.walk?.fromStart) {
    const { page, pages } = conversations.walk
    notices.push(
      `Conversation history is still loading — ${page} of ${pages}. ` +
        (usingMirror ? 'Figures are incomplete until it finishes; press Load history to continue' : 'Press Load history to continue'),
    )
  }
  if (!usingMirror) return notices

  const convState = sync.state?.get(SyncSource.Conversations)

  // A failure is reported from what the state row remembers, not only an
  // attempt made on this request, so every page load during an hour-long
  // outage still says the figures are older than they look. The error text
  // itself goes to the log; the screen only says what it means.
  const convFailed = conversations.status === SourceStatus.Failed ? conversations.detail : convState?.lastError
  if (convFailed && conversations.status !== SourceStatus.Ok) {
    console.warn('[panel] conversations could not be refreshed:', convFailed)
    notices.push(`Conversations could not be refreshed from Chatwoot — shown ${stamp(convState?.lastOkAt)}`)
  } else if (conversations.status === SourceStatus.Partial && !conversations.walk?.fromStart) {
    notices.push(`Still catching up on recent conversations — refresh to continue; figures are ${stamp(convState?.lastOkAt)}`)
  } else if (conversations.detail) {
    notices.push(capitalise(conversations.detail))
  }

  return notices
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// --- the conversations side, live ---------------------------------------------

/**
 * The per-agent Chatwoot counts go out together: seven sequential calls is a
 * nine-second page, seven at once is one second, and the account is too small
 * to be worth rate-limiting ourselves against.
 */
async function liveAgentCounts(
  agentIds: number[],
  from: Date,
  to: Date,
  inboxId?: number,
): Promise<{ byAgent: Map<number, number>; incomplete: boolean }> {
  const results = await Promise.allSettled(agentIds.map((id) => agentConversationCount(id, from, to, inboxId)))
  const byAgent = new Map<number, number>()
  let incomplete = false
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') byAgent.set(agentIds[index]!, result.value)
    else incomplete = true
  })
  return { byAgent, incomplete }
}

/**
 * A screen with the filters still on it and no figures under them — for a
 * line that was asked for and could not be honoured. Every total is zero, so
 * the page's own empty state draws above whatever `degraded` says went wrong.
 */
function empty(
  lines: { instance: string }[],
  degraded: string[],
  range: { from: Date; to: Date; clamped: boolean },
  source: FunnelSource,
  asOf: string | null,
  history: Funnel['history'],
): Funnel {
  return {
    agents: [],
    summary: { conversationsStarted: 0, conversationsAssigned: 0, avgReplySeconds: null },
    trend: [],
    lines: lines.map((line) => ({ instance: line.instance })),
    degraded,
    range: {
      from: dayOf(range.from),
      to: dayOf(new Date(range.to.getTime() - 86_400_000)),
      clamped: range.clamped,
    },
    source,
    asOf,
    history,
    agentDays: null,
    generatedAt: new Date().toISOString(),
  }
}

/** A read whose failure is a missing section of the page, not a failed page. */
async function settled<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    console.warn('[panel] funnel read failed:', error instanceof Error ? error.message : error)
    return null
  }
}

function ok<T>(value: T): Promise<T> {
  return Promise.resolve(value)
}
