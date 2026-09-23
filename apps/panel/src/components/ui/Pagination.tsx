'use client'

// framework
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'

// components
import { Icon } from './icons'

/**
 * Pager for a long table. Renders real links so pages
 * stay shareable and back-button friendly, with an optimistic page update for
 * instant feedback while the new rows load.
 */
export function Pagination({
  page,
  pageSize,
  total,
  path,
  query,
}: {
  page: number
  pageSize: number
  total: number
  /** The route the pager stays on, e.g. "/lines". */
  path: string
  /**
   * Everything else already in the URL — filters, sort — as plain values, since a
   * function can't cross from a Server Component into this client component.
   */
  query: Record<string, string>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [shown, showPage] = useOptimistic(page)

  function hrefFor(next: number): string {
    const params = new URLSearchParams(query)
    if (next > 1) params.set('page', String(next))
    else params.delete('page')
    const search = params.toString()
    return search ? `${path}?${search}` : path
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (pageCount <= 1) return null

  const from = (shown - 1) * pageSize + 1
  const to = Math.min(shown * pageSize, total)

  function go(next: number, event: React.MouseEvent) {
    // Let modified clicks (meta/ctrl/shift/alt, non-primary button) fall through to the browser default.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    startTransition(() => {
      showPage(next)
      router.push(hrefFor(next), { scroll: false })
    })
  }

  const arrow = (disabled: boolean) =>
    `inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors duration-150 ${
      disabled
        ? 'pointer-events-none border-transparent opacity-35'
        : 'border-line bg-surface hover:border-accent/40 hover:text-accent'
    }`

  return (
    <nav
      aria-label="Pagination"
      aria-busy={pending || undefined}
      className={`mt-3 flex items-center justify-between text-xs text-muted transition-opacity duration-200 ${
        pending ? 'opacity-60' : ''
      }`}
    >
      <p className="tnum">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        <Link
          href={hrefFor(Math.max(1, shown - 1))}
          onClick={(event) => go(Math.max(1, shown - 1), event)}
          aria-disabled={shown <= 1}
          tabIndex={shown <= 1 ? -1 : undefined}
          aria-label="Previous page"
          className={arrow(shown <= 1)}
        >
          <Icon.ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="tnum inline-flex items-center gap-1.5 px-1.5">
          {shown} / {pageCount}
          {pending && (
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
          )}
        </span>
        <Link
          href={hrefFor(Math.min(pageCount, shown + 1))}
          onClick={(event) => go(Math.min(pageCount, shown + 1), event)}
          aria-disabled={shown >= pageCount}
          tabIndex={shown >= pageCount ? -1 : undefined}
          aria-label="Next page"
          className={arrow(shown >= pageCount)}
        >
          <Icon.ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </nav>
  )
}
