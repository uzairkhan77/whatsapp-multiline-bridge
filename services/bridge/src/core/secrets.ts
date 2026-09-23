// AES-256-GCM encryption at rest for the secrets in the bridge.* settings tables.
// The key is SETTINGS_ENCRYPTION_KEY, held only in the environment of the bridge
// and the panel, so a database dump alone is useless. GCM authenticates, so a tampered
// value fails to decrypt rather than decrypting into something else. Deliberately duplicated in
// apps/panel/src/lib/secrets.ts: change both, the stored format is the contract.

// node
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

// Stored form, one string so it fits the existing text columns without a migration:
//   enc.v1.<iv, base64>.<auth tag, base64>.<ciphertext, base64>
// Anything without the prefix predates encryption and is returned untouched (see decryptSecret).
const PREFIX = 'enc.v1.'
const IV_BYTES = 12

/**
 * The key, or null when none is configured. Read on access rather than at import:
 * the panel evaluates every server module during its build.
 */
function key(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim()
  if (!raw) return null

  // Hex or base64, both spellings of the same 32 bytes: `openssl rand -hex 32`
  // and `openssl rand -base64 32` are both accepted.
  const bytes = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')

  if (bytes.length !== 32) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY must be 32 bytes — generate one with `openssl rand -hex 32`',
    )
  }
  return bytes
}

export function hasEncryptionKey(): boolean {
  return key() !== null
}

/** True for a value this module wrote, false for one stored before it existed. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX)
}

/**
 * Encrypt a secret for storage. Throws when no key is configured: a write must
 * never fall back to plain text.
 */
export function encryptSecret(plain: string): string {
  const k = key()
  if (!k) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY is not set, so secrets cannot be saved. ' +
        'Set it on this service and on the bridge — the same value on both.',
    )
  }

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${PREFIX}${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`
}

/**
 * Read a stored secret. A value without the prefix is returned as is, so rows
 * written before the key existed keep working; they are upgraded to ciphertext
 * on their next save, or at the bridge's next boot.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored

  const k = key()
  if (!k) {
    throw new Error(
      'A stored secret is encrypted but SETTINGS_ENCRYPTION_KEY is not set on this service. ' +
        'It must carry the same key as the service that saved it.',
    )
  }

  const [ivPart, tagPart, bodyPart] = stored.slice(PREFIX.length).split('.')
  if (!ivPart || !tagPart || !bodyPart) {
    throw new Error('A stored secret is malformed and cannot be decrypted')
  }

  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivPart, 'base64'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(bodyPart, 'base64')), decipher.final()]).toString(
    'utf8',
  )
}

/**
 * Constant-time comparison for the webhook paths, where an attacker can make
 * unlimited attempts and time each one.
 */
export function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, which would itself be the leak;
  // pad both sides to a fixed width and compare the lengths separately.
  const width = Math.max(a.length, b.length)
  return timingSafeEqual(
    Buffer.concat([a], width),
    Buffer.concat([b], width),
  ) && a.length === b.length
}
