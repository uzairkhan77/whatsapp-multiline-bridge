// Everything that must be true of the database before the bridge serves a request.

// framework
import type { FastifyBaseLogger } from 'fastify'

// storage
import { seedChatwootSettings, upgradeStoredSecrets, type ChatwootSettings } from './chatwoot-settings.js'
import type { Db } from './db.js'
import { ensureSchema } from './schema.js'

export async function prepareDatabase(
  db: Db,
  envSeed: ChatwootSettings | null,
  log: FastifyBaseLogger,
): Promise<void> {
  await ensureSchema(db)

  // Migrates the old CHATWOOT_* variables once. An existing row is never overwritten.
  if (envSeed && (await seedChatwootSettings(db, envSeed))) {
    log.info('chatwoot settings seeded from environment variables')
  }

  // Encrypts any secret still stored as plain text. A no-op after the first boot with a key.
  const upgraded = await upgradeStoredSecrets(db)
  if (upgraded > 0) log.info({ columns: upgraded }, 'stored secrets encrypted at rest')
}
