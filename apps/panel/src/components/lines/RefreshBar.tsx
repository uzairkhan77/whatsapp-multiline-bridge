'use client'

// framework
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

// components
import { Icon } from '../ui/icons'

// Auto-refresh toggle, polling every 10 to 15 seconds.
const INTERVAL_MS = 15_000

/**
 * Manual refresh, plus an auto-refresh the operator can switch off.
 */
// On by default (stale status is the failure this screen prevents); switchable so
// reading a disconnection reason isn't disrupted by the page reordering. The
// timestamp renders client-side, since a server-rendered "12s ago" goes stale at once.
export function RefreshBar({ generatedAt }: { generatedAt: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [auto, setAuto] = useState(true)
  const [age, setAge] = useState(0)

  useEffect(() => {
    setAge(0)
    const tick = setInterval(() => setAge((value) => value + 1), 1000)
    return () => clearInterval(tick)
  }, [generatedAt])

  useEffect(() => {
    if (!auto) return
    const timer = setInterval(() => startTransition(() => router.refresh()), INTERVAL_MS)
    return () => clearInterval(timer)
  }, [auto, router])

  return (
    <div className="bg-surface flex min-h-10 items-center gap-1 rounded-[var(--radius-control)] border border-line p-1 pl-3 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
      <span className="relative mr-2 inline-flex h-2 w-2" aria-hidden="true">
        <span className={`absolute inset-0 rounded-full ${auto ? 'bg-good live-dot text-good' : 'bg-muted-2'}`} />
      </span>
      <p className="tnum mr-2 hidden text-xs text-muted sm:block" aria-live="off">
        {age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`} ago
      </p>

      {/* A switch-shaped toggle: the checkbox is still the control, the track is
          the picture of it. */}
      <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs font-medium text-muted transition-colors duration-150 hover:text-fg">
        <span className="relative inline-flex h-5 w-9 items-center">
          <input
            type="checkbox"
            checked={auto}
            onChange={(event) => setAuto(event.target.checked)}
            className="peer sr-only"
          />
          <span className="peer-checked:bg-accent peer-focus-visible:ring-accent/40 absolute inset-0 rounded-full bg-muted-2/50 transition-colors duration-200 peer-focus-visible:ring-2" />
          <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-4" />
        </span>
        Auto
      </label>

      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        aria-label="Refresh now"
        className="text-muted hover:text-accent hover:bg-accent-soft inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-150"
      >
        <Icon.Refresh className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
      </button>

      {/* One polite live region for the whole page, so a refresh is announced once
          rather than every card announcing itself. */}
      <span role="status" aria-live="polite" className="sr-only">
        {pending ? 'Refreshing line status' : ''}
      </span>
    </div>
  )
}
