// Which day it is, in the business's own timezone. A team and its customers
// live in one place, so "Today" on the Funnel means their today, not the
// server's.
//
// The zone must be a FIXED-OFFSET one — every helper below adds a single
// constant, so a zone with daylight saving would be wrong for half the year.
// business-time.test.ts enforces that against Node's own zone data.
//
// Read from the environment statically, never destructured, so Next can inline
// the values into the client bundle: agent-days.ts reaches the chart
// components. No 'server-only' and no imports either — funnel-math.ts and
// agent-days.ts build on this and both run under node:test.

/** The IANA name, for Postgres (`at time zone`) and for saying it on screen. */
export const BUSINESS_TIMEZONE = process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE?.trim() || 'UTC'

/** What the timezone is called on screen and in email. */
export const BUSINESS_TIMEZONE_LABEL =
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE_LABEL?.trim() || 'UTC'

/** Hours ahead of UTC — negative means behind. The form Chatwoot's reports take as `timezone_offset`. */
export const BUSINESS_UTC_OFFSET_HOURS = offsetFromEnv()

function offsetFromEnv(): number {
  const raw = Number(process.env.NEXT_PUBLIC_BUSINESS_UTC_OFFSET_HOURS)
  // Whole hours only: Chatwoot's `timezone_offset` takes an integer, and a
  // half-hour zone would silently round rather than fail here.
  return Number.isInteger(raw) ? raw : 0
}

const OFFSET_MS = BUSINESS_UTC_OFFSET_HOURS * 3_600_000
const DAY_MS = 86_400_000

/** YYYY-MM-DD of an instant, as the business's own calendar reads it. */
export function dayOf(at: Date): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * The instant a business day begins. A string that is not a date gives an
 * invalid Date, the same as `new Date` would, so a caller can test with
 * `Number.isFinite(result.getTime())` exactly as before.
 */
export function startOfDay(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET_MS)
}

/** The instant the business day containing `at` began. */
export function startOfDayContaining(at: Date): Date {
  return startOfDay(dayOf(at))
}

/** The first business midnight strictly after `ms`. */
export function nextMidnight(ms: number): number {
  return startOfDayContaining(new Date(ms)).getTime() + DAY_MS
}

/** `days` whole days on from `at`. A day is always 24 hours here — no daylight saving to make one 23 or 25. */
export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * DAY_MS)
}
