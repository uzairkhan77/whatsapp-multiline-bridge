// Agent-days domain: the Funnel's two day-by-day tables — response time and Online time.

/** One stretch of one status, as bridge.agent_presence holds it. */
export interface PresenceInterval {
  agentId: number
  status: string
  sinceAt: Date | string
  seenAt: Date | string
}

/** Seconds per day, keyed agent id → YYYY-MM-DD. */
export type SecondsByAgentDay = Record<string, Record<string, number>>

export interface PresenceByDay {
  online: SecondsByAgentDay
  busy: SecondsByAgentDay
  /**
   * Agent → day → the bridge saw this agent at some point that day, in any
   * status. What separates "Offline all day" (recorded, 0m) from "nobody was
   * looking" (not recorded, —).
   */
  recorded: Record<string, Record<string, true>>
}

export interface DailyReplyTime {
  /** YYYY-MM-DD */
  day: string
  /** Average seconds from a customer's message to the agent's next reply. Null: no replies that day. */
  seconds: number | null
}

export interface AgentDays {
  /** Newest first. */
  days: string[]
  /** In roster order, which is by name. */
  agents: { id: number; name: string }[]
  /** Null when Chatwoot could not be read for anyone. */
  reply: {
    seconds: Record<string, Record<string, number | null>>
    /** Agents whose series could not be read; their column shows "—". */
    missing: number[]
  } | null
  /** Null when the record is not there or could not be read. `since`: the first day it holds. */
  presence: (PresenceByDay & { since: string | null }) | null
  /**
   * The record does not exist at all yet. The section is left off the screen
   * rather than shown with an apology: a feature that has not started is not
   * news to the person reading the Funnel.
   */
  presenceMissing: boolean
  /** A line is selected, and these tables do not honour it. */
  lineFilterIgnored: boolean
}

/**
 * One point per day for the charts: the day, then one value per agent keyed by
 * the agent's id as a string. Ascending by day; busy time rides along under
 * `busy:<id>` so a tooltip can mention it.
 */
export type AgentSeriesPoint = { day: string } & Record<string, number | null | string>

/** One agent's Online and Busy time added up over the whole period, in seconds. */
export interface OnlineTotal {
  id: number
  name: string
  online: number
  busy: number
  /** Days on which the agent was seen at all — zero means every day was a gap. */
  recordedDays: number
}

/** What the By-agent table shows from these two sources, per agent id. */
export interface AgentPeriodStats {
  avgReplySeconds: number | null
  onlineSeconds: number | null
}
