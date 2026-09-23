'use client'

// framework
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'

// enums
import { SortDir } from '@/enums/sort'

// components
import { Icon } from './icons'

/**
 * Sortable column heading. Renders as a real link (bookmarkable, back-button
 * friendly) with an optimistic arrow/dim update while the new order loads.
 */
export function SortHeaderLink({
  href,
  label,
  active,
  dir,
}: {
  href: string
  label: string
  active: boolean
  dir: SortDir
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // What the click is asking for: this column, in the direction its href encodes.
  const [shown, show] = useOptimistic({ active, dir })

  // Direction comes from the href, not from toggling the current sort — that avoids
  // the arrow pointing the wrong way while the server request is in flight.
  const nextDir: SortDir = href.includes('dir=asc') ? SortDir.Asc : SortDir.Desc

  return (
    <span className="inline-flex items-center gap-1">
      <Link
        href={href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
          event.preventDefault()
          startTransition(() => {
            show({ active: true, dir: nextDir })
            router.push(href, { scroll: false })
          })
        }}
        aria-busy={pending || undefined}
        className={`hover:text-accent inline-flex items-center gap-1 rounded transition-all duration-150 ${
          shown.active ? 'text-accent' : ''
        } ${pending ? 'opacity-60' : ''}`}
      >
        {label}
        <span
          className={`inline-flex h-4 w-4 items-center justify-center rounded transition-opacity duration-150 ${
            shown.active ? 'bg-accent-soft opacity-100' : 'opacity-0'
          }`}
        >
          {shown.active && shown.dir === SortDir.Asc ? (
            <Icon.SortUp className="h-3 w-3" />
          ) : (
            <Icon.SortDown className="h-3 w-3" />
          )}
        </span>
      </Link>
    </span>
  )
}
