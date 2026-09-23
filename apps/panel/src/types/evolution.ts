// Types for the Evolution (WhatsApp gateway) API (lib/evolution.ts).

export interface Instance {
  name: string
  connectionStatus: 'open' | 'close' | 'connecting' | string
  ownerJid: string | null
  profileName: string | null
  profilePicUrl: string | null
  integration: string | null
  disconnectionReasonCode: number | null
  disconnectionAt: string | null
  createdAt: string | null
  Setting?: InstanceSettings | null
}

export interface InstanceSettings {
  rejectCall: boolean
  groupsIgnore: boolean
  alwaysOnline: boolean
  readMessages: boolean
  readStatus: boolean
  syncFullHistory: boolean
}

export interface WebhookConfig {
  url: string
  enabled: boolean
  events: string[]
}

export interface QrPayload {
  base64: string | null
  code: string | null
  pairingCode: string | null
}
