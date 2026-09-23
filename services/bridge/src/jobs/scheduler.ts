// The background passes, started once the server is listening. Every timer is
// unref'd so a pending tick never keeps the process alive after shutdown.

// routing rules and alerts
import type { AutoOffline } from '../routing/auto-offline.js'
import { AGENT_PASS_EVERY_MS, type PresenceLog } from '../routing/presence.js'

// http routes and background jobs
import type { BridgeContext } from '../context.js'
import { runAgentPass } from './agent-pass.js'
import { syncWebhooks } from './webhook-sync.js'

const MINUTE_MS = 60_000

export async function startJobs(
  ctx: BridgeContext,
  services: { presence: PresenceLog; autoOffline: AutoOffline },
): Promise<void> {
  const { log, chatwoot } = ctx
  const { presence, autoOffline } = services

  const every = (ms: number, name: string, job: () => Promise<void>): void => {
    setInterval(() => {
      job().catch((error) => log.error({ err: error }, `${name} failed`))
    }, ms).unref()
  }

  const registered = new Set<string>()
  await syncWebhooks(ctx, registered)
  every(MINUTE_MS, 'webhook sync', () => syncWebhooks(ctx, registered))

  // One presence reading now, so a restart costs the record one gap rather than two.
  void presence.tick().catch((error) => log.warn({ err: error }, 'presence could not be recorded at start'))
  every(AGENT_PASS_EVERY_MS, 'agent pass', () => runAgentPass({ chatwoot, presence, autoOffline, log }))
}
