// Funnel domain: filters, sort, per-agent rows, trend points, and the assembled screen.

import type { Period } from '@/enums/period'
import type { FunnelSortKey, SortDir } from '@/enums/sort'
import type { FunnelSource } from '@/enums/funnel-source'
import type { AgentDays } from './agent-days'

export interface FunnelFilters {
  period: Period
  from?: string
  to?: string
  instance?: string
}

export interface FunnelSort {
  key: FunnelSortKey
  dir: SortDir
}

export interface AgentFunnelRow {
  id: string
  name: string
  conversations: number
  /** Average reply time over the period, seconds; null when they sent no reply or Chatwoot could not be asked. */
  avgReplySeconds: number | null
  /** Time their status was Online over the period, seconds; null while nothing has been recorded for them. */
  onlineSeconds: number | null
}

export interface FunnelTrendPoint {
  day: string
  conversations: number
}

export interface ResolvedRange {
  from: Date
  /** Exclusive: the instant after the last day in the range. */
  to: Date
  /** True when the range asked for reached back past the first day of data. */
  clamped: boolean
}

export interface FunnelSummary {
  /** Every conversation opened in the range, assigned or not — what the chart plots. */
  conversationsStarted: number
  /** Only those an agent owns, which is what the per-agent rows below add up to. */
  conversationsAssigned: number
  /** Average first-reply time across the team over the period, seconds; null when nothing was answered. */
  avgReplySeconds: number | null
}

export interface Funnel {
  agents: AgentFunnelRow[]
  summary: FunnelSummary
  trend: FunnelTrendPoint[]
  lines: { instance: string }[]
  /** Anything the screen could not read, said in the caller's own words. */
  degraded: string[]
  /** The dates actually used, after the floor above was applied. */
  range: { from: string; to: string; clamped: boolean }
  /** Which reads produced these figures. */
  source: FunnelSource
  /** When the copy was last brought fully up to date, ISO. Null until it has been. */
  asOf: string | null
  /** The first fill of conversation history, while it is still running. */
  history: { page: number; pages: number } | null
  /**
   * The two day-by-day tables — response time and Online time per agent. Null
   * on the paths that show no agents at all. Never filtered by line; see
   * assembleAgentDays.
   */
  agentDays: AgentDays | null
  generatedAt: string
}
