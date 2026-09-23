// Types for the lines dashboard (lib/dashboard.ts).
import type { DailyVolume } from './db'
import type { LineHealth } from '@/enums/line-health'

export interface LineView {
  instance: string
  health: LineHealth
  /** E.164 as far as we can tell from the JID the gateway reports. */
  phone: string | null
  profileName: string | null
  profilePicUrl: string | null
  chatwootInboxId: number | null
  fallbackInstance: string | null
  reason: string | null
  disconnectedAt: string | null
  inbound: number
  outbound: number
  conversations: number
  lastActivity: string | null
}

/** Chatwoot's own counts for one inbox, which is one WhatsApp line. */
export interface InboxCount {
  total: number
  unassigned: number
}

export interface Dashboard {
  lines: LineView[]
  /**
   * Handed over unresolved and streamed in — Chatwoot answers in 6-8 seconds
   * vs tens of ms for everything else. Never rejects: a failed read resolves
   * to an empty map, shown as unavailable rather than a stale or wrong number.
   */
  chatwootCounts: Promise<Map<number, InboxCount>>
  volume: DailyVolume[]
  /** Set when a source failed. The page still renders — line state matters more than totals. */
  degraded: string[]
  gatewayReachable: boolean
  generatedAt: string
}
