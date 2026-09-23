// What the route handlers and the boot-time passes are handed: index.ts wires the
// clients and stores together once and puts them in this bag.

// framework
import type { FastifyBaseLogger } from 'fastify'

// configuration and logging
import type { Config } from './core/config.js'

// storage
import type { ChatwootSettings } from './storage/chatwoot-settings.js'
import type { Db } from './storage/db.js'
import type { LineStore } from './storage/line-store.js'
import type { SingleRowStore } from './storage/settings-store.js'

// clients of other systems
import type { ChatwootClient } from './clients/chatwoot.js'
import type { EvolutionClient } from './clients/evolution.js'

// alerts
import type { LineAlerts } from './alerts/alerts.js'

export interface BridgeContext {
  config: Config
  db: Db
  lines: LineStore
  settings: SingleRowStore<ChatwootSettings>
  chatwoot: ChatwootClient
  evolution: EvolutionClient
  alerts: LineAlerts
  log: FastifyBaseLogger
}
