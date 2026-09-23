// framework
import Link from 'next/link'

// components
import { Icon } from '@/components/ui/icons'

export default function NotFound() {
  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 py-10 sm:px-6">
      <div className="card rise w-full p-6 text-center sm:p-7">
        <span className="icon-tile mx-auto h-11 w-11 bg-warn-soft text-warn">
          <Icon.Warning className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">No such line</h1>
        <p className="mt-1 text-sm text-muted">
          There is no line by that name. It may have been deleted, or the address may be mistyped.
        </p>
        <Link
          href="/"
          className="bg-accent-gradient mt-5 inline-flex min-h-10 items-center gap-1.5 rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition-all duration-200 hover:brightness-110"
        >
          <Icon.ArrowLeft className="h-4 w-4" />
          Back to all lines
        </Link>
      </div>
    </div>
  )
}
