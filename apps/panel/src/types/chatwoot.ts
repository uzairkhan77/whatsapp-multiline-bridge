// Chatwoot domain: shapes read from or sent to the Chatwoot API.

export interface ChatwootSummary {
  conversations: number
  incomingMessages: number
  outgoingMessages: number
  /** Seconds. Null when the window holds too few replies for Chatwoot to average. */
  avgFirstResponseSeconds: number | null
  resolutions: number
}

export interface ChatwootInbox {
  id: number
  name: string
  /** e.g. "Channel::Api". Shown so an obviously wrong pick (a website widget) looks wrong. */
  channelType: string
}

export interface ChatwootAgent {
  id: number
  name: string
  email: string
  /** What Chatwoot currently reports. Shown live in the picker so the list is not guesswork. */
  availability: 'online' | 'busy' | 'offline' | 'unknown'
}

/** One condition for the conversation filter endpoint, without the operator that joins it to the next. */
export interface FilterClause {
  attribute_key: string
  filter_operator: string
  values: unknown[]
}

export interface DailyConversations {
  /** YYYY-MM-DD */
  day: string
  conversations: number
}
