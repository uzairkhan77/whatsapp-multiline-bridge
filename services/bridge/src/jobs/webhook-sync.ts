// Keeps every enabled line's Evolution webhook pointed at this bridge. Runs at
// boot and then every minute, so a line added in the panel starts delivering
// without a restart.

// configuration and logging
import type { Config } from '../core/config.js'

// http routes and background jobs
import type { BridgeContext } from '../context.js'

const isLocal = (url: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?)(:|\/|$)/i.test(url)

/**
 * True when this bridge is local but the gateway is not: registering would
 * repoint the live lines at a developer's machine and silently stop inbound
 * messages. Happens with EVOLUTION_BASE_URL set to the VM in a local .env.
 */
export function wouldHijackRemoteWebhooks(config: Config): boolean {
  return !isLocal(config.evolution.baseUrl) && isLocal(config.publicUrl)
}

/**
 * Registers each enabled line not yet in `registered`. Only successes are
 * remembered, so a failed registration is retried on the next pass.
 */
export async function syncWebhooks(ctx: BridgeContext, registered: Set<string>): Promise<void> {
  const { lines, evolution, config, log } = ctx
  const base = config.publicUrl.replace(/\/+$/, '')

  for (const line of await lines.all()) {
    if (!line.enabled || registered.has(line.instance)) continue
    // Instance names may contain spaces or slashes; Fastify decodes the segment on the way in.
    const url = `${base}/webhooks/evolution/${encodeURIComponent(line.instance)}`
    try {
      await evolution.setWebhook(
        line.instance,
        url,
        ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'MESSAGES_DELETE', 'MESSAGES_EDITED'],
        config.evolution.webhookSecret,
      )
      registered.add(line.instance)
      log.info({ instance: line.instance, url }, 'webhook registered with Evolution')
    } catch (error) {
      log.error({ err: error, instance: line.instance }, 'could not register webhook')
    }
  }
}
