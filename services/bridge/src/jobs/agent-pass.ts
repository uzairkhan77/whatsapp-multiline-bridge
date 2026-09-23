// One read of Chatwoot's agent list, used twice: recorded as presence, then
// judged by the auto-offline rule. The two halves fail independently; if
// Chatwoot does not answer, nothing is recorded and nobody is set offline.

// framework
import type { FastifyBaseLogger } from 'fastify'

// clients of other systems
import type { ChatwootClient } from '../clients/chatwoot.js'

// routing rules and alerts
import type { AutoOffline } from '../routing/auto-offline.js'
import type { PresenceLog } from '../routing/presence.js'

export interface AgentPassDeps {
  chatwoot: ChatwootClient
  presence: PresenceLog
  autoOffline: AutoOffline
  log: FastifyBaseLogger
}

export async function runAgentPass({ chatwoot, presence, autoOffline, log }: AgentPassDeps): Promise<void> {
  let agents
  try {
    agents = await chatwoot.listAgents()
  } catch (error) {
    log.warn({ err: error }, 'agent pass: Chatwoot did not answer')
    return
  }
  await presence.tick(agents).catch((error) => log.warn({ err: error }, 'presence could not be recorded'))
  await autoOffline.run(agents).catch((error) => log.error({ err: error }, 'auto-offline pass failed'))
}
