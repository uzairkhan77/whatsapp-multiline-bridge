// Settings view domain: shapes the Settings screen's client components pass as props.

export interface AutoOfflineView {
  enabled: boolean
  thresholdMinutes: number
}

/** One agent this rule has set Offline, ready for the browser. */
export interface AutoOfflineEventView {
  agent: string
  conversationId: number | null
  waitedMinutes: number | null
  /** ISO 8601 UTC — LocalDate turns it into the reader's own timezone. */
  at: string
}

/**
 * What this form receives is deliberately incomplete: the token and secret arrive
 * as their last four characters only, so the full values are never in the page.
 * An empty secret field on submit means "keep what is stored".
 */
export interface SettingsView {
  baseUrl: string
  accountId: string
  apiTokenLast4: string | null
  webhookSecretLast4: string | null
  /** 'env' = values are still coming from environment variables, nothing saved yet. */
  source: 'db' | 'env' | null
}
