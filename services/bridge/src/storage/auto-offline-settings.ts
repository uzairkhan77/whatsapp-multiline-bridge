// bridge.auto_offline_settings — the inactivity rule's switch and limit, one row
// (docs/03-availability.md, "Setting inactive agents Offline"). Cached by settings-store.ts.

// storage
import type { Db } from './db.js'

export interface AutoOfflineSettings {
  enabled: boolean
  thresholdMinutes: number
}

export async function loadAutoOfflineSettings(db: Db): Promise<AutoOfflineSettings | null> {
  const result = await db.pool.query<AutoOfflineSettings>(
    `select enabled,
            threshold_minutes as "thresholdMinutes"
       from bridge.auto_offline_settings
      where id = 1`,
  )
  return result.rows[0] ?? null
}
