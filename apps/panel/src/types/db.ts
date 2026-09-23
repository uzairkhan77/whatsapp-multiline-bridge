// Types for panel database reads (lib/db.ts).

export interface LineTotals {
  instance: string
  inbound: number
  outbound: number
  conversations: number
  lastActivity: string | null
}

export interface DailyVolume {
  day: string
  inbound: number
  outbound: number
}

export interface ActivityRow {
  direction: 'inbound' | 'outbound'
  chatwootConversationId: number | null
  sentViaInstance: string | null
  createdAt: string
}
