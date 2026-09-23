// bridge.lines — which WhatsApp line feeds which Chatwoot inbox. Cached by line-store.ts.

// storage
import type { Db } from './db.js'

export interface LineRow {
  instance: string
  /** Null when the inbox was detached: the line is known, but routes nothing. */
  chatwootInboxId: number | null
  fallbackInstance: string | null
  enabled: boolean
}

export async function loadLines(db: Db): Promise<LineRow[]> {
  const result = await db.pool.query<LineRow>(
    `select instance,
            chatwoot_inbox_id as "chatwootInboxId",
            fallback_instance as "fallbackInstance",
            enabled
       from bridge.lines
      order by instance`,
  )
  return result.rows
}
