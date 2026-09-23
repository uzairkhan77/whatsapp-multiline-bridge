// Shared by server and client rendering, so nothing here may touch node APIs.

export function compact(n: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function full(n: number): string {
  return new Intl.NumberFormat('en').format(n)
}

/** Currency code comes from the API response, never hardcoded — a business selling
 * across borders cannot assume its own currency. */
export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    amount,
  )
}

/** "+92 310 2811596" — grouped so a human can read it back over the phone. */
export function prettyPhone(e164: string | null): string | null {
  if (!e164) return null
  const digits = e164.replace(/\D/g, '')
  if (digits.length < 7) return e164
  const country = digits.slice(0, digits.length - 10) || digits.slice(0, 2)
  const rest = digits.slice(country.length)
  return `+${country} ${rest.slice(0, 3)} ${rest.slice(3)}`.trim()
}

/** How long ago, in the coarsest unit that is still true — "minutes" versus "days" is what matters here. */
export function since(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short' })
}

/** Seconds as a response time an operator reads at a glance. */
export function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${(minutes / 60).toFixed(1)}h`
}

export function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en', { day: 'numeric', month: 'short' })
}

/**
 * Seconds as hours and minutes — time spent, as against `duration` for time
 * waited: "6h 20m", "6h", "45m", "0m". Rounded to the minute.
 */
export function hoursMinutes(seconds: number | null): string {
  if (seconds === null) return '—'
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A span of days: "Sep 11–17", "Aug 28 – Sep 3", "Dec 30, 2025 – Jan 2, 2026",
 * or "Sep 17" for one day. Both ends inclusive, YYYY-MM-DD in. Built from the
 * parts rather than toLocaleDateString, so it reads the same on every server.
 */
export function periodLabel(from: string, to: string): string {
  const [ay, am, ad] = from.split('-').map(Number) as [number, number, number]
  const [by, bm, bd] = to.split('-').map(Number) as [number, number, number]
  const monthDay = (m: number, d: number) => `${MONTHS[m - 1]} ${d}`
  if (from === to) return monthDay(am, ad)
  if (ay !== by) return `${monthDay(am, ad)}, ${ay} – ${monthDay(bm, bd)}, ${by}`
  if (am !== bm) return `${monthDay(am, ad)} – ${monthDay(bm, bd)}`
  return `${monthDay(am, ad)}–${bd}`
}
