import 'server-only'

// node
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

// Encryption at rest for secrets in the bridge.* settings tables — protects a
// database copy (backup, dump, pooler credential) leaving without the servers.
// The key, SETTINGS_ENCRYPTION_KEY, lives only in the bridge's and the panel's
// environment. Duplicated in services/bridge/src/core/secrets.ts — the format
// below is the contract between them; change one, change both.

// AES-256-GCM: encryption and an auth tag in one pass, so tampering fails to
// decrypt rather than decrypting into something else. Stored as one string:
//   enc.v1.<iv, base64>.<auth tag, base64>.<ciphertext, base64>
// The prefix is the version marker; a value without it predates this and is
// returned untouched — see decryptSecret.
const PREFIX = 'enc.v1.'
const IV_BYTES = 12

/**
 * The key, or null when none is configured. Read on access rather than at
 * import: the panel evaluates every server module during its build, on a
 * machine that has no reason to hold production secrets.
 */
function key(): Buffer | null {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim()
  if (!raw) return null

  // Hex or base64, both spellings of the same 32 bytes — `openssl rand -hex 32`
  // and `openssl rand -base64 32` are the two commands people reach for.
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
 * Encrypt a secret for storage. Throws when no key is configured — falling
 * back to plain text on a write would quietly undo the whole point.
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
 * Read a stored secret. A value without the prefix is returned as-is, so rows
 * written before the key existed keep working and upgrade to ciphertext the
 * next time they are saved, or at the bridge's next boot.
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
 * Compare two secrets without leaking how much of a guess was right through
 * timing. Used on webhook paths, where an attacker can measure many attempts.
 */
export function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, itself a leak — pad both
  // sides to a fixed width first so the lengths never need comparing directly.
  const width = Math.max(a.length, b.length)
  return timingSafeEqual(
    Buffer.concat([a], width),
    Buffer.concat([b], width),
  ) && a.length === b.length
}
