// The timezone alert emails are written in, so an agent reads a time that
// matches the clock on their wall.
//
// The zone must be a FIXED-OFFSET one: the formatting below adds a single
// constant rather than consulting zone data, so daylight saving would be wrong
// for half the year.
//
// The one module that reads the environment outside core/config.ts. It has to
// stay import-free: alert-templates.ts builds on it and runs under node:test,
// where the full config (and its required variables) is not loaded.

/** Hours ahead of UTC — negative means behind. */
export const BUSINESS_UTC_OFFSET_HOURS = offsetFromEnv()

/** What the timezone is called in an email. */
export const BUSINESS_TIMEZONE_LABEL = process.env.BUSINESS_TIMEZONE_LABEL?.trim() || 'UTC'

function offsetFromEnv(): number {
  const raw = Number(process.env.BUSINESS_UTC_OFFSET_HOURS)
  return Number.isInteger(raw) ? raw : 0
}
