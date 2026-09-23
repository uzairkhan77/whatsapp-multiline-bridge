// Cached single-row settings: the Chatwoot account and the auto-offline rule.
// Edited from the Operator Console; the 30-second TTL is the propagation delay.

// storage
import type { AutoOfflineSettings } from './auto-offline-settings.js'
import { loadAutoOfflineSettings } from './auto-offline-settings.js'
import type { ChatwootSettings } from './chatwoot-settings.js'
import { loadChatwootSettings } from './chatwoot-settings.js'
import type { Db } from './db.js'

const TTL_MS = 30_000

export class SingleRowStore<T> {
  private cache: T | null = null
  // Unlike LineStore, "never loaded" and "empty table" must stay apart: an empty table
  // is "not configured" and is served as null (fail closed); a failed read is "unknown"
  // and falls back to the last good value.
  private hasLoaded = false
  private loadedAt = 0
  private inFlight: Promise<T | null> | null = null

  constructor(private readonly load: () => Promise<T | null>) {}

  /** Forces the next read to go to the database. Used after a write. */
  invalidate(): void {
    this.loadedAt = 0
  }

  /** The current row, or null when none has been configured yet. */
  async get(): Promise<T | null> {
    if (this.hasLoaded && Date.now() - this.loadedAt < TTL_MS) return this.cache

    if (!this.inFlight) {
      this.inFlight = this.load()
        .then((row) => {
          this.cache = row
          this.hasLoaded = true
          this.loadedAt = Date.now()
          return row
        })
        .finally(() => {
          this.inFlight = null
        })
    }

    try {
      return await this.inFlight
    } catch (error) {
      // Serve the last known good row. The Chatwoot store is on the hot path of every
      // message; treating a database blip as "no settings" would 401 every agent reply.
      if (this.hasLoaded) return this.cache
      throw error
    }
  }
}

export function chatwootSettingsStore(db: Db): SingleRowStore<ChatwootSettings> {
  return new SingleRowStore(() => loadChatwootSettings(db))
}

// An empty table means the feature was never configured and stays off; a database
// blip serves the last good answer rather than changing anyone's availability.
export function autoOfflineSettingsStore(db: Db): SingleRowStore<AutoOfflineSettings> {
  return new SingleRowStore(() => loadAutoOfflineSettings(db))
}
