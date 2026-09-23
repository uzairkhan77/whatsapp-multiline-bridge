// bridge.notification_emails — who gets alert email.

// storage
import type { Db } from './db.js'

/** Read at send time, not cached: alerts are rare and the list must be current. */
export async function loadNotificationEmails(db: Db): Promise<string[]> {
  const result = await db.pool.query<{ email: string }>(
    `select email from bridge.notification_emails order by email`,
  )
  return result.rows.map((row) => row.email)
}
