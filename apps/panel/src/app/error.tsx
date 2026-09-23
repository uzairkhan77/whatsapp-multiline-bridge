'use client'

// components
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons'

/**
 * Reached only when something the dashboard cannot degrade around fails — a
 * missing env var, or the bridge database unreachable.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto grid min-h-dvh max-w-lg place-items-center px-4 py-10 sm:px-6">
      <div className="card rise w-full p-6 sm:p-7">
        <span className="icon-tile h-11 w-11 bg-danger-soft text-danger">
          <Icon.Warning className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">The dashboard could not load</h1>
        <p className="mt-1 text-sm text-muted">
          Line status is unknown right now — this is not a report that everything is fine.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-muted">
          {error.message}
        </pre>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={reset}>
            <Icon.Refresh className="h-4 w-4" />
            Try again
          </Button>
        </div>
        <p className="mt-5 border-t border-line pt-4 text-xs text-muted">
          If this keeps happening, contact support.
        </p>
      </div>
    </div>
  )
}
