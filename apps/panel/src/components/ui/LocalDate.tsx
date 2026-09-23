'use client'

// framework
import { useSyncExternalStore } from 'react'

// enums
import { DateStyle } from '@/enums/date-style'

// Renders timestamps in the browser's local timezone; a Server
// Component would use the server's UTC zone instead. useSyncExternalStore lets the
// UTC server snapshot swap for the local client snapshot after hydration, without a mismatch warning.

const OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  [DateStyle.Date]: { day: 'numeric', month: 'short', year: 'numeric' },
  [DateStyle.DateTime]: { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' },
}

function format(iso: string, style: DateStyle, timeZone?: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en', { ...OPTIONS[style], timeZone }).format(date)
}

const subscribe = () => () => {}

export function LocalDate({ iso, style = DateStyle.Date, className }: { iso: string; style?: DateStyle; className?: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => format(iso, style),
    () => format(iso, style, 'UTC'),
  )
  // Full local timestamp on hover, for when the date-only text needs disambiguating.
  const title = useSyncExternalStore(
    subscribe,
    () => format(iso, DateStyle.DateTime),
    () => `${format(iso, DateStyle.DateTime, 'UTC')} UTC`,
  )

  return (
    <time dateTime={iso} title={title} className={className}>
      {text}
    </time>
  )
}
