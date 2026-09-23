import 'server-only'

// enums
import { LineHealth } from '@/enums/line-health'

// types
import type { InboxCount } from '@/types/dashboard'
import type { LineDetail } from '@/types/line-detail'

// lib
import { inboxCounts } from './chatwoot'
import { dailyVolume, lineTotals, recentActivity } from './db'
import { disconnectReason, fetchInstances, findWebhook } from './evolution'
import { configuredLines } from './lines'
import { timed } from './memo'

function phoneFromJid(jid: string | null): string | null {
  if (!jid) return null
  const digits = jid.split('@')[0]?.replace(/\D/g, '')
  return digits ? `+${digits}` : null
}

export async function loadLine(instance: string): Promise<LineDetail | null> {
  const config = (await timed('db lines', configuredLines)).find((line) => line.instance === instance) ?? null

  // Started here, awaited by the page's own Suspense boundary rather than by
  // this function — Chatwoot answers in seconds and nothing else on the page
  // should wait behind it.
  const inboxId = config?.chatwootInboxId ?? null
  const openConversations: Promise<InboxCount | null> =
    inboxId !== null
      ? timed(`chatwoot inbox ${inboxId} counts`, () => inboxCounts(inboxId)).catch(() => null)
      : Promise.resolve(null)

  const [instancesResult, totalsResult, volumeResult, activityResult, webhookResult] =
    await Promise.allSettled([
      timed('gateway instances', fetchInstances),
      timed('db totals', lineTotals),
      timed('db volume', () => dailyVolume(14, instance)),
      timed('db activity', () => recentActivity(instance)),
      timed('gateway webhook', () => findWebhook(instance)),
    ])

  const found =
    instancesResult.status === 'fulfilled'
      ? instancesResult.value.instances.find((entry) => entry.name === instance)
      : undefined

  // Neither the gateway nor the routing table has heard of it — a bad URL, not an outage.
  if (!found && !config) return null

  const totals =
    totalsResult.status === 'fulfilled'
      ? totalsResult.value.find((row) => row.instance === instance)
      : undefined

  const webhook = webhookResult.status === 'fulfilled' ? webhookResult.value : null


  const gatewayReadable = instancesResult.status === 'fulfilled' && !instancesResult.value.stale

  // A detached line reads the same as one never given an inbox.
  const health: LineHealth = !config || config.chatwootInboxId === null
    ? LineHealth.Unconfigured
    : !found
      ? gatewayReadable
        ? LineHealth.Missing
        : LineHealth.Unknown
      : !config.enabled
        ? LineHealth.Disabled
        : found.connectionStatus === 'open'
          ? LineHealth.Up
          : found.connectionStatus === 'connecting'
            ? LineHealth.Connecting
            : LineHealth.Down

  return {
    instance,
    health,
    phone: phoneFromJid(found?.ownerJid ?? null),
    profileName: found?.profileName ?? null,
    reason:
      found && found.connectionStatus !== 'open'
        ? disconnectReason(found.disconnectionReasonCode)
        : null,
    disconnectedAt: found?.disconnectionAt ?? null,
    createdAt: found?.createdAt ?? null,
    settings: found?.Setting ?? null,
    config,
    webhook,
    // The bridge registers `/webhooks/evolution/<instance>`. Anything else means the
    // gateway is delivering somewhere we are not listening, or not at all.
    webhookMatchesLine: Boolean(
      webhook?.enabled &&
        webhook.url.endsWith(`/webhooks/evolution/${encodeURIComponent(instance)}`),
    ),
    inbound: totals?.inbound ?? 0,
    outbound: totals?.outbound ?? 0,
    conversations: totals?.conversations ?? 0,
    lastActivity: totals?.lastActivity ?? null,
    openConversations,
    volume: volumeResult.status === 'fulfilled' ? volumeResult.value : [],
    activity: activityResult.status === 'fulfilled' ? activityResult.value : [],
  }
}
