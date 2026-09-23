// The wording of every alert email. alerts.ts decides when to send; this file says
// what. Plain text, not HTML: read on a phone, in a hurry. Every message answers
// what happened, whether a person must act, and when.

// configuration
import { BUSINESS_TIMEZONE_LABEL, BUSINESS_UTC_OFFSET_HOURS } from '../core/business-time.js'

export interface AlertEmail {
  subject: string
  text: string
}

/**
 * "instance (+number)" in every subject and opening line: the number is what a
 * reader acts on, the name is what the Operator Console lists the line under. Name
 * alone when the number is unknown (gateway unreachable, or instance logged out).
 */
export function lineLabel(instance: string, phone: string | null): string {
  return phone ? `${instance} (${phone})` : instance
}

/**
 * Baileys disconnect codes in words. 401 is absent on purpose: it has its own
 * email (lineLoggedOut), because it is the only code that can never resolve itself.
 */
export function reasonInWords(code: number | null | undefined): string {
  if (code === null || code === undefined) return 'No reason was reported.'
  const known: Record<number, string> = {
    401: 'Logged out from the phone — the line needs a new QR scan.',
    403: 'Blocked by WhatsApp.',
    405: 'Not authorised — the session was replaced.',
    408: 'Connection timed out.',
    428: 'Connection closed by WhatsApp.',
    440: 'Session replaced by another device — is something else running with the same session?',
    500: 'Bad session file.',
    515: 'Restart required — usually clears on its own.',
  }
  return known[code] ?? `Disconnected with code ${code}.`
}

/** Baileys' code for "the phone unlinked this device". Its own alert — see below. */
export const LOGGED_OUT_CODE = 401

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * "Tue 8 Sep 2026, 13:28:33 UTC". Hand-built rather than Intl, so the format cannot
 * shift with the container's locale data. Always UTC (the team spans timezones);
 * weekday and seconds included so it answers "was it the weekend" and matches log lines.
 */
export function utcTimestamp(date: Date = new Date()): string {
  return (
    `${DAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()}, ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  )
}

function withTime(lines: string[]): string {
  return [...lines, '', `Time: ${utcTimestamp()}`].join('\n')
}

/**
 * "Thu 17 Sep 2026, 22:15 Dubai time (Fri 18 Sep 2026, 03:15:30 UTC)", for an email
 * an agent reads about themselves. Their clock first; UTC kept to match the logs.
 * The offset and label default to the configured business timezone — see
 * core/business-time.ts — and are arguments so the tests can pin them.
 */
export function localTimestamp(
  date: Date = new Date(),
  offsetHours: number = BUSINESS_UTC_OFFSET_HOURS,
  label: string = BUSINESS_TIMEZONE_LABEL,
): string {
  const local = new Date(date.getTime() + offsetHours * 3_600_000)
  return (
    `${DAYS[local.getUTCDay()]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ` +
    `${local.getUTCFullYear()}, ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} ${label} ` +
    `(${utcTimestamp(date)})`
  )
}

/** "8 seconds", "1 minute 5 seconds" — a duration read at a glance, not parsed. */
export function inWords(seconds: number): string {
  const whole = Math.max(1, Math.round(seconds))
  if (whole < 60) return `${whole} second${whole === 1 ? '' : 's'}`
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  const head = `${minutes} minute${minutes === 1 ? '' : 's'}`
  return rest === 0 ? head : `${head} ${rest} second${rest === 1 ? '' : 's'}`
}

/** A line disconnected and stayed down past the grace period: the everyday outage, and it usually comes back. */
export function lineDown(
  instance: string,
  phone: string | null,
  reasonCode: number | null | undefined,
  graceSeconds: number,
): AlertEmail {
  const label = lineLabel(instance, phone)
  return {
    subject: `WhatsApp line ${label} is DOWN`,
    text: withTime([
      `The WhatsApp line "${label}" disconnected and has stayed down for more than ${graceSeconds} seconds.`,
      '',
      reasonInWords(reasonCode),
      '',
      'Customers messaging this number are not reaching anyone. If it needs a new QR scan,',
      'open the Operator Console, find the line and use Connect.',
    ]),
  }
}

/**
 * Logged out (401): the phone unlinked the device and the stored session is gone.
 * Unlike every other disconnect it cannot heal itself; somebody must scan a new QR,
 * and the subject line says so.
 */
export function lineLoggedOut(instance: string, phone: string | null): AlertEmail {
  const label = lineLabel(instance, phone)
  return {
    subject: `WhatsApp line ${label} was LOGGED OUT — someone must scan a new QR`,
    text: withTime([
      `The WhatsApp line "${label}" was logged out from the phone. The saved session is gone,`,
      'and this will NOT fix itself — waiting changes nothing.',
      '',
      'A person has to do this:',
      '',
      `  1. Open the Operator Console, find the line "${instance}" and press Connect.`,
      `  2. On the phone holding ${phone ?? 'this number'}, open WhatsApp →`,
      '     Settings → Linked devices → Link a device.',
      '  3. Scan the QR code the panel is showing.',
      '',
      'Until that is done, customers messaging this number reach nobody, and agents',
      'cannot reply on it. Conversation history is kept and comes back with the line.',
    ]),
  }
}

/**
 * A line came up with no outage open: a first connection, or a manual reconnect
 * after a scan. Sent so whoever scanned knows it worked without refreshing the panel.
 */
export function lineConnected(instance: string, phone: string | null): AlertEmail {
  const label = lineLabel(instance, phone)
  return {
    subject: `WhatsApp line ${label} is connected`,
    text: withTime([
      `The WhatsApp line "${label}" is connected and carrying messages.`,
      '',
      'Nothing to do — this is the confirmation that the scan worked. Customers',
      'messaging this number now reach Chatwoot as usual.',
    ]),
  }
}

/**
 * The all-clear for an outage already reported. Deliberately not lineConnected:
 * this one says what happened to the messages sent during the gap.
 */
export function lineReconnected(
  instance: string,
  phone: string | null,
  downForSeconds: number | null,
): AlertEmail {
  const label = lineLabel(instance, phone)
  return {
    subject: `WhatsApp line ${label} reconnected`,
    text: withTime([
      `The WhatsApp line "${label}" is connected again — the outage reported earlier is over.`,
      ...(downForSeconds === null ? [] : ['', `It was down for ${inWords(downForSeconds)}.`]),
      '',
      'Messages customers sent while it was down are delivered by WhatsApp on reconnect',
      'and flow into Chatwoot as usual. Anything an agent sent from Chatwoot during the',
      'outage was NOT queued — check those conversations and resend if needed.',
    ]),
  }
}

/**
 * An agent was set Offline by the inactivity rule (docs/03-availability.md, rule 7).
 * Sent to the agent alone, with the evidence the rule acted on; it asks nothing of
 * them. Times are on the agent's own clock, the business timezone's.
 */
export function agentTakenOffline(
  agentName: string,
  conversationId: number,
  waitedMinutes: number,
  thresholdMinutes: number,
): AlertEmail {
  return {
    subject: `You were set Offline in Chatwoot for inactivity`,
    text: [
      `Hi ${agentName},`,
      '',
      `You were set Offline in Chatwoot automatically: you had sent nothing for more than`,
      `${thresholdMinutes} minutes while a customer assigned to you was waiting for a reply.`,
      '',
      `The customer who had waited longest is on conversation #${conversationId},`,
      `waiting ${waitedMinutes} minute${waitedMinutes === 1 ? '' : 's'} at the time. That conversation is still yours.`,
      '',
      'While you are Offline, no new customers are handed to you. Nothing else has',
      'changed: your conversations are still assigned to you and you have not been',
      'signed out.',
      '',
      `Time: ${localTimestamp()}`,
    ].join('\n'),
  }
}

/**
 * A line dropped and came back inside the grace period, so no DOWN alert was sent.
 * A record, not a call for help: a line that does this twice a day has a problem.
 * The subject must never say DOWN.
 */
export function lineBrieflyDown(
  instance: string,
  phone: string | null,
  downForSeconds: number,
  reasonCode: number | null | undefined,
): AlertEmail {
  const label = lineLabel(instance, phone)
  return {
    subject: `WhatsApp line ${label} dropped briefly and recovered`,
    text: withTime([
      `The WhatsApp line "${label}" disconnected and came back on its own after ${inWords(downForSeconds)}.`,
      '',
      reasonInWords(reasonCode),
      '',
      'Nothing to do — it recovered before the outage alert was due, so this is a',
      'record rather than a call for help. Messages customers sent during the gap are',
      'delivered by WhatsApp on reconnect.',
      '',
      'Worth watching if it keeps happening: a line that drops repeatedly is usually a',
      'weak connection on the phone, or the same number signed in somewhere else.',
    ]),
  }
}
