// Settings domain: rows read from the bridge's settings tables in the database.

export interface ChatwootSettings {
  baseUrl: string
  accountId: string
  apiToken: string
  webhookSecret: string
  /** Where the values came from — 'env' means the table is empty and these are inert leftovers. */
  source: 'db' | 'env'
}

export interface AutoOfflineSettings {
  enabled: boolean
  /** How long a customer may wait, and an agent stay silent, before the agent is set Offline. */
  thresholdMinutes: number
}

export interface AutoOfflineEvent {
  agentName: string | null
  agentEmail: string | null
  conversationId: number | null
  waitedMinutes: number | null
  at: Date
}
