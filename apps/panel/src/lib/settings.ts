import 'server-only'

// framework
import { cache } from 'react'

// types
import type { AutoOfflineEvent, AutoOfflineSettings, ChatwootSettings } from '@/types/settings'

// lib
import { query } from './db'
import { forget, remember } from './memo'
import { decryptSecret } from './secrets'

// The Chatwoot account settings, read from bridge.chatwoot_settings — the same
// row the bridge reads. Written by the save action in app/actions.ts; this
// module only reads. The env fallback is transitional: the bridge migrates the
// old CHATWOOT_* variables into the table on its first boot, and `source` tells
// the settings screen which world it is looking at until then.

// Read once per request (React cache) and kept for a few seconds across
// requests (lib/memo). forgetChatwootSettings() is called on save so a rotated
// token is in use on the next request, not after the window.
const SETTINGS_KEY = 'settings:chatwoot'

export const getChatwootSettings = cache(async (): Promise<ChatwootSettings | null> => {
  const { value } = await remember(SETTINGS_KEY, readChatwootSettings, { ttlMs: 15_000, staleMs: 60_000 })
  return value
})

export function forgetChatwootSettings(): void {
  forget(SETTINGS_KEY)
}

async function readChatwootSettings(): Promise<ChatwootSettings | null> {
  const rows = await query<Omit<ChatwootSettings, 'source'>>(`
    select base_url       as "baseUrl",
           account_id     as "accountId",
           api_token      as "apiToken",
           webhook_secret as "webhookSecret"
      from bridge.chatwoot_settings
     where id = 1`)

  // The two secrets are stored encrypted — see lib/secrets.ts. A row written
  // before that existed is plain text and passes through untouched.
  const row = rows[0]
  if (row) {
    return {
      ...row,
      apiToken: decryptSecret(row.apiToken),
      webhookSecret: decryptSecret(row.webhookSecret),
      source: 'db',
    }
  }

  const accountId = process.env.CHATWOOT_ACCOUNT_ID?.trim()
  const apiToken = process.env.CHATWOOT_API_TOKEN?.trim()
  if (!accountId || !apiToken) return null

  return {
    baseUrl: (process.env.CHATWOOT_BASE_URL?.trim() || 'https://app.chatwoot.com').replace(/\/+$/, ''),
    accountId,
    apiToken,
    webhookSecret: process.env.CHATWOOT_WEBHOOK_SECRET?.trim() ?? '',
    source: 'env',
  }
}

/** The last four characters, for showing that a secret exists without showing it. */
export function last4(value: string): string {
  return value.slice(-4)
}

/** Addresses that receive alert emails — line disconnects, and whatever step 8 adds. */
export async function listNotificationEmails(): Promise<string[]> {
  const rows = await query<{ email: string }>(
    `select email from bridge.notification_emails order by email`,
  )
  return rows.map((row) => row.email)
}

/**
 * When agents are set Offline automatically — the same row the bridge reads
 * before each pass. Null means never configured, shown as off: this changes a
 * person's own account, so it should take someone deciding to switch it on.
 */
export async function getAutoOfflineSettings(): Promise<AutoOfflineSettings | null> {
  const rows = await query<AutoOfflineSettings>(`
    select enabled,
           threshold_minutes as "thresholdMinutes"
      from bridge.auto_offline_settings
     where id = 1`)
  return rows[0] ?? null
}

/**
 * The most recent agents set Offline by the rule, newest first — how anyone
 * checks the rule is behaving, and how "why was I set offline" gets answered.
 */
export async function listRecentAutoOfflineEvents(limit = 10): Promise<AutoOfflineEvent[]> {
  const rows = await query<AutoOfflineEvent>(
    `select agent_name               as "agentName",
            agent_email              as "agentEmail",
            chatwoot_conversation_id as "conversationId",
            waited_minutes           as "waitedMinutes",
            created_at               as "at"
       from bridge.agent_offline_events
      order by created_at desc
      limit $1`,
    [limit],
  )
  return rows
}

// No SMTP settings here any more. Alert email goes through Resend, configured
// by RESEND_API_KEY and ALERT_FROM_EMAIL in the environment — see lib/mailer.ts.
