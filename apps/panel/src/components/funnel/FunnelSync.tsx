'use client'

// framework
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

// enums
import { DateStyle } from '@/enums/date-style'
import { FunnelSource } from '@/enums/funnel-source'

// lib
import { syncFunnelNow } from '@/app/actions' // add rebuildFunnelHistory back when the button returns

// components
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons'
import { LocalDate } from '@/components/ui/LocalDate'

/**
 * Shows when the Funnel's copy was last synced, with manual controls for the
 * first fill and catch-up syncs beyond what auto-refresh covers.
 */
// No auto-refresh here: every open tab syncing every 30 seconds would be wasteful
// against figures that only change a few times an hour.
export function FunnelSync({
  asOf,
  history,
  source,
}: {
  asOf: string | null
  history: { page: number; pages: number } | null
  source: FunnelSource
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(action: () => Promise<{ ok: boolean; error?: string; warning?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) setError(result.error ?? 'The refresh failed')
      else if (result.warning) setError(result.warning)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="tnum text-xs text-muted" aria-live="polite">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : asOf ? (
          <>
            Data updated <LocalDate iso={asOf} style={DateStyle.DateTime} />
          </>
        ) : (
          'Not updated yet'
        )}
      </p>

      {history ? (
        <Button variant="primary" busy={pending} onClick={() => run(syncFunnelNow)}>
          <Icon.Refresh className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
          Load history ({history.page} of {history.pages})
        </Button>
      ) : (
        <>
          <Button busy={pending} onClick={() => run(syncFunnelNow)} aria-label="Refresh the data now">
            <Icon.Refresh className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
            Refresh data
          </Button>
          {/* Hidden for now; restore by uncommenting.
          <Button
            variant="ghost"
            busy={pending}
            onClick={() => {
              if (window.confirm('Read every conversation from Chatwoot again? Nothing is lost; it takes a minute or two.')) {
                run(rebuildFunnelHistory)
              }
            }}
          >
            Rebuild history
          </Button>
          */}
        </>
      )}
    </div>
  )
}
