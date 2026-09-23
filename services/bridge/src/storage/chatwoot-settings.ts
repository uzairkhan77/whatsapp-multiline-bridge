// bridge.chatwoot_settings — the Chatwoot account, with its secrets encrypted at rest.

// storage
import type { Db } from './db.js'

// utilities
import { decryptSecret, encryptSecret, hasEncryptionKey, isEncrypted } from '../core/secrets.js'

export interface ChatwootSettings {
  baseUrl: string
  accountId: string
  apiToken: string
  webhookSecret: string
}

/**
 * The Chatwoot account, with its two secrets decrypted. A row written before encryption
 * existed is plain text and comes back unchanged (format and reasons in core/secrets.ts).
 */
export async function loadChatwootSettings(db: Db): Promise<ChatwootSettings | null> {
  const result = await db.pool.query<ChatwootSettings>(
    `select base_url       as "baseUrl",
            account_id     as "accountId",
            api_token      as "apiToken",
            webhook_secret as "webhookSecret"
       from bridge.chatwoot_settings
      where id = 1`,
  )
  const row = result.rows[0]
  if (!row) return null

  return {
    ...row,
    apiToken: decryptSecret(row.apiToken),
    webhookSecret: decryptSecret(row.webhookSecret),
  }
}

/**
 * Encrypt any Chatwoot secret still stored as plain text, once, at boot. Returns the
 * number of columns rewritten; does nothing when no encryption key is configured.
 */
export async function upgradeStoredSecrets(db: Db): Promise<number> {
  if (!hasEncryptionKey()) return 0

  const result = await db.pool.query<{ apiToken: string; webhookSecret: string }>(
    `select api_token as "apiToken", webhook_secret as "webhookSecret"
       from bridge.chatwoot_settings
      where id = 1`,
  )
  const row = result.rows[0]
  if (!row) return 0

  const updates: string[] = []
  const values: string[] = []
  if (!isEncrypted(row.apiToken)) {
    updates.push(`api_token = $${updates.length + 1}`)
    values.push(encryptSecret(row.apiToken))
  }
  if (!isEncrypted(row.webhookSecret)) {
    updates.push(`webhook_secret = $${updates.length + 1}`)
    values.push(encryptSecret(row.webhookSecret))
  }
  if (updates.length === 0) return 0

  await db.pool.query(
    `update bridge.chatwoot_settings set ${updates.join(', ')} where id = 1`,
    values,
  )
  return updates.length
}

/**
 * One-time migration of the old CHATWOOT_* environment variables. `on conflict do nothing`
 * means an existing row (e.g. one edited in the panel) is never overwritten by a redeploy.
 */
export async function seedChatwootSettings(db: Db, s: ChatwootSettings): Promise<boolean> {
  // Encrypted on the way in when a key is configured; otherwise plain text, which
  // upgradeStoredSecrets converts on the first boot that has a key.
  const protect = (value: string): string => (hasEncryptionKey() ? encryptSecret(value) : value)

  const result = await db.pool.query(
    `insert into bridge.chatwoot_settings (base_url, account_id, api_token, webhook_secret)
     values ($1, $2, $3, $4)
     on conflict (id) do nothing
     returning id`,
    [s.baseUrl, s.accountId, protect(s.apiToken), protect(s.webhookSecret)],
  )
  return result.rows.length > 0
}
