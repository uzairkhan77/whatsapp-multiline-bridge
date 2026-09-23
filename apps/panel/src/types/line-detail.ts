// Types for a single line's detail page (lib/line-detail.ts).
import type { ActivityRow, DailyVolume } from './db'
import type { ConfiguredLine } from './lines'
import type { Instance, WebhookConfig } from './evolution'
import type { InboxCount } from './dashboard'
import type { LineHealth } from '@/enums/line-health'

export interface LineDetail {
  instance: string
  health: LineHealth
  phone: string | null
  profileName: string | null
  reason: string | null
  disconnectedAt: string | null
  createdAt: string | null
  settings: Instance['Setting']
  config: ConfiguredLine | null
  webhook: WebhookConfig | null
  /** True when the gateway is delivering this line's events to the bridge we expect. */
  webhookMatchesLine: boolean
  inbound: number
  outbound: number
  conversations: number
  lastActivity: string | null
  /**
   * Chatwoot's open-conversation count, handed over unresolved so the page can
   * stream it — the same reasoning as Dashboard.chatwootCounts. Resolves to null
   * when there is no inbox or Chatwoot could not be read.
   */
  openConversations: Promise<InboxCount | null>
  volume: DailyVolume[]
  activity: ActivityRow[]
}
