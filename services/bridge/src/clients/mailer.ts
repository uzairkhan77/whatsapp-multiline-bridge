// Alert email through Resend's HTTP API: one POST to the send endpoint, one API
// key in the environment, no SDK.

// configuration and logging
import type { ResendConfig } from '../core/config.js'

// storage
import type { Db } from '../storage/db.js'
import { loadNotificationEmails } from '../storage/notification-emails.js'

const ENDPOINT = 'https://api.resend.com/emails'

/** How many addresses a message went to, or why it went to none. */
export interface SendResult {
  sent: number
  reason?: string
}

export class Mailer {
  constructor(
    private readonly db: Db,
    private readonly resend: ResendConfig,
  ) {}

  /**
   * Send to every configured recipient. Returns the outcome rather than throwing:
   * the callers are alert paths inside webhook handlers carrying real traffic.
   */
  async send(subject: string, text: string): Promise<SendResult> {
    const recipients = await loadNotificationEmails(this.db)
    if (recipients.length === 0) return { sent: 0, reason: 'no notification emails configured' }
    return this.deliver(subject, text, recipients)
  }

  /** Send to one person only (e.g. being set Offline). The notification addresses are not copied. */
  async sendToPerson(to: string, subject: string, text: string): Promise<SendResult> {
    return this.deliver(subject, text, [to])
  }

  private async deliver(subject: string, text: string, to: string[]): Promise<SendResult> {
    if (!this.resend.apiKey) {
      return { sent: 0, reason: 'RESEND_API_KEY is not set on the bridge' }
    }

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.resend.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.resend.fromEmail,
          // One mail, recipients visible to each other: a small internal team.
          to,
          subject,
          text,
        }),
      })

      if (!response.ok) {
        // Resend's rejection body is the diagnosis (unverified sending domain, bad
        // key); carried to the log verbatim.
        const body = await response.text().catch(() => '')
        return { sent: 0, reason: `Resend rejected the send (${response.status}): ${body.slice(0, 300)}` }
      }

      return { sent: to.length }
    } catch (error) {
      return { sent: 0, reason: `could not reach Resend: ${String(error)}` }
    }
  }
}
