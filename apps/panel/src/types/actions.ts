// Actions domain: Server Action inputs and results for app/actions.ts and the auth actions.

export interface ActionResult {
  ok: boolean
  error?: string
  /** The action worked, but something adjacent needs a person's attention. */
  warning?: string
}

export interface ChatwootSettingsInput {
  baseUrl: string
  accountId: string
  /** Empty string means "keep the stored value" — the form never echoes secrets back. */
  apiToken: string
  webhookSecret: string
}

export interface AutoOfflineSettingsInput {
  enabled: boolean
  thresholdMinutes: number
}

export interface InboxOption {
  id: number
  name: string
  channelType: string
  /** The line this inbox already feeds, if any — shown disabled in the picker. */
  assignedTo: string | null
}

export interface ForgotState {
  sent?: boolean
  error?: string
  email?: string
}

export interface LoginState {
  error?: string
  email?: string
}

export interface ResetState {
  error?: string
}
