import 'server-only'

// types
import type { SendResult } from '@/types/mailer'

// The panel's copy of the bridge's Resend sender (services/bridge/src/clients/mailer.ts).
// Duplicated rather than shared, same as lib/secrets.ts and lib/chatwoot.ts.
// Both services must read the same RESEND_API_KEY and ALERT_FROM_EMAIL values.

const ENDPOINT = 'https://api.resend.com/emails'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * "Tue 8 Sep 2026, 13:28:33 UTC" — the same stamp the bridge's alerts carry.
 * Kept identical to utcTimestamp() in services/bridge/src/alerts/alert-templates.ts.
 */
export function utcTimestamp(date: Date = new Date()): string {
  return (
    `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()}, ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  )
}

export function alertFromEmail(): string {
  // Resend only accepts a verified sending domain. onboarding@resend.dev is
  // the unverified fallback, delivering only to the account's own address.
  return process.env.ALERT_FROM_EMAIL?.trim() || 'onboarding@resend.dev'
}

/** Sends one email to every recipient. Never throws — the error comes back in the result. */
export async function sendEmail(
  to: string[],
  subject: string,
  text: string,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.warn('[panel] RESEND_API_KEY is not set, so no email can be sent')
    return { ok: false, error: 'Email sending is not configured on this panel, so no email can be sent.' }
  }
  if (to.length === 0) return { ok: false, error: 'There is nobody to send to.' }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: alertFromEmail(), to, subject, text }),
    })

    if (!response.ok) {
      // Resend explains a rejection in the body (unverified domain, revoked
      // key) — passed straight through to the person who pressed the button.
      const body = await response.text().catch(() => '')
      return { ok: false, error: `Resend refused the send (${response.status}): ${body.slice(0, 300)}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `Could not reach Resend: ${String(error)}` }
  }
}
