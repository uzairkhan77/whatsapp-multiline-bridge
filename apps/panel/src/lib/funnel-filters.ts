// Split out of lib/funnel.ts: no 'server-only' import, so the client-side
// FunnelFilters component can import this without pulling in Chatwoot, the
// routing table, or `pg`.

// enums
import { Period } from '@/enums/period'

/** Every value a period in the URL may take. The page falls back to a fortnight for anything else. */
export const PERIODS: Period[] = Object.values(Period)

// Every day is a business day — see lib/business-time.ts. The longer ranges
// stay listed even though history does not reach back that far yet: lib/funnel.ts
// clamps to the first day there is data for and the screen says which dates it used.
export const PERIOD_PRESETS: { value: Period; label: string }[] = [
  { value: Period.Today, label: 'Today' },
  { value: Period.Yesterday, label: 'Yesterday' },
  { value: Period.Days7, label: '7 days' },
  { value: Period.Days14, label: '14 days' },
  { value: Period.Days30, label: '30 days' },
  { value: Period.Days90, label: '90 days' },
  { value: Period.All, label: 'All time' },
]
