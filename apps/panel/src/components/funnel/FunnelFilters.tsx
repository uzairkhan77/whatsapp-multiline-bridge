'use client'

// framework
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'

// enums
import { Period } from '@/enums/period'

// lib
import { PERIOD_PRESETS } from '@/lib/funnel-filters'

// components
import { Icon } from '../ui/icons'

/**
 * Global filters for the Funnel screen: date period and line.
 * State lives in the URL, so a filtered view is bookmarkable and shareable.
 */
export function FunnelFilters({
  period,
  from,
  to,
  instance,
  lines,
}: {
  period: Period
  from?: string
  to?: string
  instance: string
  lines: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  // The clicked tab highlights immediately while the URL update runs in a transition;
  // old figures stay on screen, dimmed, until the new ones arrive — no skeleton flash.
  const [shown, showPeriod] = useOptimistic(period)

  function update(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') params.delete(key)
      else params.set(key, value)
    }
    startTransition(() => {
      if (next.period) showPeriod(next.period as Period)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    })
  }

  const segment = (active: boolean) =>
    `min-h-8 rounded-lg px-3 text-sm font-medium transition-all duration-200 ${
      active
        ? 'bg-surface text-accent shadow-[0_1px_3px_rgb(15_23_42/0.12)]'
        : 'text-muted hover:text-fg'
    }`

  return (
    <div className="card flex flex-wrap items-center gap-3 p-2 sm:p-2.5" aria-busy={pending || undefined}>
      <div className="bg-surface-2 flex flex-wrap gap-0.5 rounded-xl p-1" role="group" aria-label="Period">
        {PERIOD_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            aria-pressed={shown === preset.value}
            onClick={() => update({ period: preset.value, from: undefined, to: undefined })}
            className={segment(shown === preset.value)}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={shown === Period.Custom}
          onClick={() => update({ period: Period.Custom })}
          className={segment(shown === Period.Custom)}
        >
          Custom
        </button>
      </div>

      {period === Period.Custom && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <input
            type="date"
            value={from ?? ''}
            max={to}
            onChange={(event) => update({ from: event.target.value })}
            className="input min-h-9 w-auto py-1.5"
            aria-label="From date"
          />
          <span className="text-muted">to</span>
          <input
            type="date"
            value={to ?? ''}
            min={from}
            onChange={(event) => update({ to: event.target.value })}
            className="input min-h-9 w-auto py-1.5"
            aria-label="To date"
          />
        </div>
      )}

      {/* appearance-none + custom chevron: the native select arrow reserves its own
          space regardless of padding, leaving a gap no pr-* could close. */}
      <div className="relative sm:ml-auto">
        <Icon.Connected className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-2" />
        <select
          value={instance}
          onChange={(event) => update({ instance: event.target.value })}
          className="input min-h-9 w-auto appearance-none py-1.5 pr-9 pl-9"
          aria-label="Line"
        >
          {/* The OS-rendered dropdown panel doesn't reliably inherit the select's CSS
              colour, so options need an explicit colour or get the OS default. */}
          <option value="all" className="text-fg">
            All lines
          </option>
          {lines.map((line) => (
            <option key={line} value={line} className="text-fg">
              {line}
            </option>
          ))}
        </select>
        <Icon.ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
      </div>

      {pending && (
        <span className="text-muted inline-flex items-center gap-1.5 text-xs" role="status">
          <span
            className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          Updating
        </span>
      )}
    </div>
  )
}
