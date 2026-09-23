// Cached view of bridge.lines. Shared with the Operator Console through the database,
// so a line added there starts routing here without a bridge restart.

// storage
import { type Db } from './db.js'
import { loadLines, type LineRow } from './lines.js'

export type Line = LineRow

/** Consulted on every message; the TTL is how long a panel edit takes to reach the bridge. */
const TTL_MS = 30_000

export class LineStore {
  private cache: Line[] = []
  private loadedAt = 0
  private inFlight: Promise<Line[]> | null = null

  constructor(private readonly db: Db) {}

  /** Forces the next read to go to the database. Used at boot and after a write. */
  invalidate(): void {
    this.loadedAt = 0
  }

  async all(): Promise<Line[]> {
    if (Date.now() - this.loadedAt < TTL_MS) return this.cache

    // Collapse concurrent refreshes into one query.
    if (!this.inFlight) {
      this.inFlight = loadLines(this.db)
        .then((rows) => {
          this.cache = rows
          this.loadedAt = Date.now()
          return rows
        })
        .finally(() => {
          this.inFlight = null
        })
    }

    try {
      return await this.inFlight
    } catch (error) {
      // Serve the last known good list: an empty list makes every line unknown, and
      // unknown lines drop customer messages. Stale routing is the lesser failure.
      if (this.cache.length > 0) return this.cache
      throw error
    }
  }

  async byInstance(instance: string): Promise<Line | undefined> {
    return (await this.all()).find((line) => line.instance === instance)
  }

  async byInboxId(inboxId: number): Promise<Line | undefined> {
    return (await this.all()).find((line) => line.chatwootInboxId === inboxId)
  }
}
