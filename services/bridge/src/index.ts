// Bridge between the Evolution gateway and Chatwoot.
//
//   inbound   WhatsApp → Evolution webhook → http/inbound.ts → Chatwoot
//   outbound  agent reply in Chatwoot → webhook → http/outbound.ts → Evolution
//
// This file builds the services, registers the routes and starts the process.

// framework
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify'

// configuration and logging
import { chatwootEnvSeed, loadConfig, type Config } from './core/config.js'
import { loggerOptions } from './core/logger.js'

// storage
import { createDb, type Db } from './storage/db.js'
import { LineStore } from './storage/line-store.js'
import { prepareDatabase } from './storage/migrate.js'
import { autoOfflineSettingsStore, chatwootSettingsStore } from './storage/settings-store.js'

// clients of other systems
import { ChatwootClient } from './clients/chatwoot.js'
import { EvolutionClient } from './clients/evolution.js'
import { Mailer } from './clients/mailer.js'

// routing rules and alerts
import { AutoOffline } from './routing/auto-offline.js'
import { PresenceLog } from './routing/presence.js'
import { LineAlerts } from './alerts/alerts.js'

// http routes and background jobs
import type { BridgeContext } from './context.js'
import { registerHealth } from './http/health.js'
import { registerInbound } from './http/inbound.js'
import { registerOutbound } from './http/outbound.js'
import { logEachRequest } from './http/request-log.js'
import { startJobs } from './jobs/scheduler.js'
import { wouldHijackRemoteWebhooks } from './jobs/webhook-sync.js'

// utilities
import { ffmpegAvailable } from './media/audio.js'

interface Services extends Omit<BridgeContext, 'config' | 'log'> {
  mailer: Mailer
  autoOffline: AutoOffline
  presence: PresenceLog
}

function createServices(config: Config, log: FastifyBaseLogger): Services {
  const db = createDb(config.databaseUrl)
  const lines = new LineStore(db)
  const settings = chatwootSettingsStore(db)
  const chatwoot = new ChatwootClient(settings)
  const evolution = new EvolutionClient(config)
  const mailer = new Mailer(db, config.resend)

  const autoOffline = new AutoOffline(db, chatwoot, autoOfflineSettingsStore(db), mailer, log)
  const presence = new PresenceLog(db, chatwoot, log)
  const alerts = new LineAlerts(evolution, mailer, log, config.lineDisconnectAlertSeconds)

  return { db, lines, settings, chatwoot, evolution, mailer, autoOffline, presence, alerts }
}

function createApp(): FastifyInstance {
  return Fastify({
    logger: loggerOptions(),
    // Evolution posts whole message payloads; the 1MB default is too tight for media metadata.
    bodyLimit: 10 * 1024 * 1024,
    // Fastify's two log lines per request are replaced by one in logEachRequest.
    logController: new LogController({ disableRequestLogging: true }),
  })
}

function shutdownOnSignal(app: FastifyInstance, db: Db): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down')
      app
        .close()
        .then(() => db.close())
        .then(
          () => process.exit(0),
          (error: unknown) => {
            app.log.error({ err: error }, 'shutdown failed')
            process.exit(1)
          },
        )
    })
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const app = createApp()
  const { log } = app
  const services = createServices(config, log)
  const ctx: BridgeContext = { config, log, ...services }

  logEachRequest(app)
  registerHealth(app, services.db)
  registerInbound(app, ctx)
  registerOutbound(app, ctx)

  await prepareDatabase(services.db, chatwootEnvSeed(), log)

  // Missing pieces the bridge can run without, said once at the top of the log.
  const lines = await services.lines.all()
  if (!(await services.settings.get())) log.warn('no Chatwoot settings configured — set the account in the Operator Console')
  if (!config.resend.apiKey) log.warn('RESEND_API_KEY is not set — alerts are logged but not emailed')
  if (!(await ffmpegAvailable())) log.warn('ffmpeg is not installed — voice notes are delivered unconverted and will not play on iPhones')
  if (lines.length === 0) log.warn('no lines in bridge.lines — nothing is routed until one is added')

  shutdownOnSignal(app, services.db)
  await app.listen({ port: config.port, host: '0.0.0.0' })

  // A local bridge must never repoint the live lines at itself. Outbound still works.
  if (wouldHijackRemoteWebhooks(config)) {
    log.warn(
      { gateway: config.evolution.baseUrl, publicUrl: config.publicUrl },
      'refusing to register webhooks: local bridge, remote gateway. Set BRIDGE_PUBLIC_URL to an address the gateway can reach',
    )
    return
  }

  // A line that dropped while the bridge was down raised no event; one sweep catches it.
  void services.alerts.checkAtBoot(lines.filter((line) => line.enabled).map((line) => line.instance))
  await startJobs(ctx, services)
}

main().catch((error: unknown) => {
  console.error('bridge failed to start', error)
  process.exit(1)
})
