import 'server-only'

// enums
import { LineHealth } from '@/enums/line-health'

// types
import type { Dashboard, InboxCount, LineView } from '@/types/dashboard'
import type { DailyVolume } from '@/types/db'
import type { Instance } from '@/types/evolution'

// lib
import { inboxCounts } from './chatwoot'
import { dailyVolume, lineTotals } from './db'
import { disconnectReason, fetchInstances } from './evolution'
import { configuredLines } from './lines'
import { remember, timed } from './memo'

function ago(at: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - at) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`
}

function phoneFromJid(jid: string | null): string | null {
  if (!jid) return null
  const digits = jid.split('@')[0]?.replace(/\D/g, '')
  return digits ? `+${digits}` : null
}

function healthOf(instance: Instance | undefined, enabled: boolean, gatewayReadable: boolean): LineHealth {
  // "Missing from gateway" means a routed line the gateway never heard of, not
  // an unreachable gateway — conflating the two raised a false alarm on every
  // healthy line whenever the connection wobbled.
  if (!instance) return gatewayReadable ? LineHealth.Missing : LineHealth.Unknown
  if (!enabled) return LineHealth.Disabled
  if (instance.connectionStatus === 'open') return LineHealth.Up
  if (instance.connectionStatus === 'connecting') return LineHealth.Connecting
  return LineHealth.Down
}

/**
 * One read of every source, merged into what the screen shows. Deliberately
 * tolerant: only the gateway's failure blanks the line list, since that list
 * is the reason this page exists. Everything else degrades to "unavailable".
 */
export async function loadDashboard(): Promise<Dashboard> {
  const degraded: string[] = []

  // Counts are read fresh every time (ttl 0); the memo's fallback shows the
  // last good reading, flagged, instead of every card dropping to 0.
  const [instancesResult, totalsResult, volumeResult, configuredResult] = await Promise.allSettled([
    timed('gateway instances', fetchInstances),
    timed('db totals', () => remember('db:totals', lineTotals, { ttlMs: 0 })),
    timed('db volume', () => remember('db:volume:14', () => dailyVolume(14), { ttlMs: 0 })),
    timed('db lines', configuredLines),
  ])

  const instances = instancesResult.status === 'fulfilled' ? instancesResult.value.instances : []
  const gatewayReachable = instancesResult.status === 'fulfilled' && !instancesResult.value.stale
  if (instancesResult.status === 'rejected') {
    degraded.push('The WhatsApp connection service is unreachable — line status is unknown')
  } else if (instancesResult.value.stale) {
    degraded.push('The WhatsApp connection service did not answer — line status is the last reading, not live')
  }

  const totals = totalsResult.status === 'fulfilled' ? totalsResult.value.value : []
  if (totalsResult.status === 'rejected') degraded.push('Message counts unavailable')
  else if (totalsResult.value.stale) {
    degraded.push(`Message counts could not be refreshed — showing the reading from ${ago(totalsResult.value.at)}`)
  }

  const volume = volumeResult.status === 'fulfilled' ? volumeResult.value.value : []
  if (volumeResult.status === 'rejected') degraded.push('Message volume unavailable')

  // Started with the others but allowed to throw, unlike them: without the
  // routing table every line would be drawn as "not configured" — a specific,
  // alarming claim rather than a missing number.
  if (configuredResult.status === 'rejected') throw configuredResult.reason
  const configured = configuredResult.value

  // Passed on unresolved — see Dashboard.chatwootCounts. Each inbox settles on
  // its own, so one slow inbox does not hold the others.
  const inboxIds = configured.flatMap((line) =>
    line.chatwootInboxId === null ? [] : [line.chatwootInboxId],
  )
  const chatwootCounts = Promise.all(
    inboxIds.map(async (inboxId) => {
      try {
        const count = await timed(`chatwoot inbox ${inboxId} counts`, () => inboxCounts(inboxId))
        return [inboxId, count] as const
      } catch {
        return null
      }
    }),
  ).then((entries) => new Map(entries.filter((entry) => entry !== null)))
  const totalsBy = new Map(totals.map((t) => [t.instance, t]))
  const instanceBy = new Map(instances.map((i) => [i.name, i]))

  // A line the gateway knows about but the routing table does not is shown, not
  // hidden: it is connected and receiving messages the bridge will drop.
  const names = [...new Set([...configured.map((l) => l.instance), ...instances.map((i) => i.name)])]

  const lines: LineView[] = names.map((name) => {
    const config = configured.find((l) => l.instance === name)
    const instance = instanceBy.get(name)
    const totalsRow = totalsBy.get(name)

    return {
      instance: name,
      // A detached line reads the same as one never given an inbox: both drop
      // everything received, and both are fixed with "Assign inbox".
      health:
        config && config.chatwootInboxId !== null
          ? healthOf(instance, config.enabled, gatewayReachable)
          : LineHealth.Unconfigured,
      phone: phoneFromJid(instance?.ownerJid ?? null),
      profileName: instance?.profileName ?? null,
      profilePicUrl: instance?.profilePicUrl ?? null,
      chatwootInboxId: config?.chatwootInboxId ?? null,
      fallbackInstance: config?.fallbackInstance ?? null,
      reason:
        instance && instance.connectionStatus !== 'open'
          ? disconnectReason(instance.disconnectionReasonCode)
          : null,
      disconnectedAt: instance?.disconnectionAt ?? null,
      inbound: totalsRow?.inbound ?? 0,
      outbound: totalsRow?.outbound ?? 0,
      conversations: totalsRow?.conversations ?? 0,
      lastActivity: totalsRow?.lastActivity ?? null,
    }
  })

  lines.sort((a, b) => {
    // Anything needing attention first, so a 2am check does not need to scan
    // a healthy list to find the one number that is down.
    const rank: Record<LineHealth, number> = {
      [LineHealth.Down]: 0,
      [LineHealth.Unconfigured]: 1,
      [LineHealth.Missing]: 2,
      [LineHealth.Connecting]: 3,
      [LineHealth.Unknown]: 4,
      [LineHealth.Disabled]: 5,
      [LineHealth.Up]: 6,
    }
    return rank[a.health] - rank[b.health] || a.instance.localeCompare(b.instance)
  })

  return {
    lines,
    chatwootCounts,
    volume,
    degraded,
    gatewayReachable,
    generatedAt: new Date().toISOString(),
  }
}
