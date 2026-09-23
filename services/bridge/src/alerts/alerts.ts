// Turns connection.update events into alert emails. Five messages — DOWN, LOGGED
// OUT (code 401), BRIEF DROP, CONNECTED, RECONNECTED — worded in alert-templates.ts.
// Rule: one email per real event, not per gateway event. Evolution emits
// close / connecting / open in bursts during ordinary reconnects and QR pairing.

// framework
import type { FastifyBaseLogger } from 'fastify'

// clients of other systems
import type { EvolutionClient } from '../clients/evolution.js'
import type { Mailer } from '../clients/mailer.js'

// routing rules and alerts
import type { AlertEmail } from './alert-templates.js'
import {
  LOGGED_OUT_CODE,
  inWords,
  lineBrieflyDown,
  lineConnected,
  lineDown,
  lineLabel,
  lineLoggedOut,
  lineReconnected,
  reasonInWords,
} from './alert-templates.js'

/** What we know about a line that is currently down. */
interface Outage {
  /** When the first close of this outage arrived, for reporting how long it lasted. */
  since: number
  /** The code from the first close, so the recovery email can still name the cause. */
  reasonCode: number | null | undefined
  /** Set once someone has been emailed about it — the difference between a drop and an outage. */
  alerted: boolean
}

export class LineAlerts {
  /** Verification timers for lines that just reported close. */
  private readonly pending = new Map<string, NodeJS.Timeout>()
  /** Lines currently believed to be down, and what we know about why. */
  private readonly outages = new Map<string, Outage>()
  /**
   * Last believed state per line, for the CONNECTED email only: 'open' is news only
   * when the line was known not to be open (Evolution repeats connection.update, and
   * a restart sees 'open' for a week-old line). A line absent here stays silent.
   */
  private readonly lastState = new Map<string, 'open' | 'down'>()

  constructor(
    private readonly evolution: EvolutionClient,
    private readonly mailer: Mailer,
    private readonly log: FastifyBaseLogger,
    /** How long a line must stay down before it counts as an outage rather than a drop. */
    private readonly graceSeconds: number,
  ) {}

  onUpdate(instance: string, state: string | undefined, reasonCode?: number | null): void {
    if (state === 'open') {
      this.onOpen(instance)
      return
    }

    // 'connecting' is not an outage and starts no countdown. It is recorded as 'down'
    // only for a line with no reading yet, so a new line's first 'open' sends CONNECTED.
    // For a known line it is WhatsApp's routine reconnect; recording it emailed every few hours.
    if (state !== 'close') {
      if (state && !this.lastState.has(instance)) this.lastState.set(instance, 'down')
      return
    }

    this.lastState.set(instance, 'down')

    // Already counting down or already reported: the same outage. The clock keeps
    // running from the first close.
    if (this.outages.has(instance)) return

    this.outages.set(instance, { since: Date.now(), reasonCode, alerted: false })

    // Wait, then check the gateway: the grace period absorbs the close→open flap of
    // a reconnect, and the check catches a recovery whose 'open' event was lost.
    const timer = setTimeout(() => {
      this.pending.delete(instance)
      void this.verifyAndAlert(instance)
    }, this.graceSeconds * 1000)
    // A pending alert must never be what keeps the process from exiting.
    timer.unref()
    this.pending.set(instance, timer)

    // Every line this class logs starts with ALERT, so one grep tells the story of
    // an outage (docs/02-deployment.md). Context carries only the raw code.
    this.log.warn(
      { instance, reasonCode },
      `ALERT ${instance} went down — ${reasonInWords(reasonCode)} ` +
        `Waiting ${this.graceSeconds}s to see if it comes back.`,
    )
  }

  /**
   * Boot-time sweep: a line that died while the bridge was down produced no event.
   * A line found open is recorded, so the first repeat 'open' is not emailed as new.
   */
  async checkAtBoot(instances: string[]): Promise<void> {
    for (const instance of instances) {
      try {
        const state = await this.evolution.connectionState(instance)
        if (state === 'open') this.lastState.set(instance, 'open')
        else this.onUpdate(instance, 'close')
      } catch {
        // A silent gateway at boot is the healthcheck's alarm; guessing line states
        // would alert on every cold start.
      }
    }
  }

  /** A line reported open. Which good-news email, if any, depends on what was believed before. */
  private onOpen(instance: string): void {
    const outage = this.outages.get(instance)
    const previous = this.lastState.get(instance)
    this.cancel(instance)
    this.outages.delete(instance)
    this.lastState.set(instance, 'open')

    const downFor = outage ? (Date.now() - outage.since) / 1000 : null

    // A reported outage is over: the all-clear, which has to explain the gap.
    if (outage?.alerted) {
      void this.send(instance, (phone) => lineReconnected(instance, phone, downFor), 'reconnected')
      return
    }

    // Down and back inside the grace period. No DOWN alert was sent, so this is
    // the record of a drop, not an all-clear.
    if (outage) {
      void this.send(
        instance,
        (phone) => lineBrieflyDown(instance, phone, downFor ?? 0, outage.reasonCode),
        `dropped for ${inWords(downFor ?? 0)} and recovered`,
      )
      return
    }

    // Known not to be open: a first connection, or a manual reconnect after a scan.
    if (previous === 'down') {
      void this.send(instance, (phone) => lineConnected(instance, phone), 'connected')
      return
    }

    // Already believed open (a repeat event) or never seen: no change, no email.
  }

  private cancel(instance: string): void {
    const timer = this.pending.get(instance)
    if (timer) {
      clearTimeout(timer)
      this.pending.delete(instance)
    }
  }

  private async verifyAndAlert(instance: string): Promise<void> {
    const outage = this.outages.get(instance)
    if (!outage) return

    try {
      const state = await this.evolution.connectionState(instance)
      if (state === 'open') {
        // Recovered without an 'open' event. Still a drop, so it is reported as one.
        const downFor = (Date.now() - outage.since) / 1000
        this.outages.delete(instance)
        this.lastState.set(instance, 'open')
        await this.send(
          instance,
          (phone) => lineBrieflyDown(instance, phone, downFor, outage.reasonCode),
          `dropped for ${inWords(downFor)} and recovered`,
        )
        return
      }
    } catch {
      // Unreachable gateway: proceed with the alert. The line reported close and
      // nothing since has said otherwise.
    }

    outage.alerted = true

    // 401 is a different event, not a worse disconnect: the phone unlinked this
    // device and waiting cannot bring the session back. Its own subject line so
    // "someone has to go and scan" is visible in an inbox list.
    const loggedOut = outage.reasonCode === LOGGED_OUT_CODE

    await this.send(
      instance,
      (phone) =>
        loggedOut
          ? lineLoggedOut(instance, phone)
          : lineDown(instance, phone, outage.reasonCode, this.graceSeconds),
      loggedOut ? 'logged out' : 'DOWN',
      { failureIsCritical: true, reasonCode: outage.reasonCode },
    )
  }

  /**
   * One send, one log line. A failed alert must be as visible in the log as the
   * outage it failed to report. The line's number is looked up here; a gateway that
   * cannot answer must not cost the alert, so the email falls back to the instance name.
   */
  private async send(
    instance: string,
    build: (phone: string | null) => AlertEmail,
    what: string,
    options: { failureIsCritical?: boolean; reasonCode?: number | null } = {},
  ): Promise<void> {
    let phone: string | null = null
    try {
      phone = await this.evolution.ownerNumber(instance)
    } catch {
      // Number unknown; the email says the instance name and nothing about a number.
    }

    const email = build(phone)
    const label = lineLabel(instance, phone)
    const result = await this.mailer.send(email.subject, email.text)

    if (result.sent > 0) {
      const detail =
        options.reasonCode === undefined ? '' : ` ${reasonInWords(options.reasonCode)}`
      const line = `ALERT ${label} ${what} — emailed ${result.sent} recipient(s).${detail}`
      if (options.failureIsCritical) this.log.warn({ instance, phone, recipients: result.sent }, line)
      else this.log.info({ instance, phone, recipients: result.sent }, line)
      return
    }

    // Bad news that went nowhere is an error (a dead line and a silent alert
    // system); good news failing to send is only a warning.
    const line = `ALERT ${label} ${what} but NO EMAIL WAS SENT — ${result.reason}`
    if (options.failureIsCritical) this.log.error({ instance, phone, reason: result.reason }, line)
    else this.log.warn({ instance, phone, reason: result.reason }, line)
  }
}
