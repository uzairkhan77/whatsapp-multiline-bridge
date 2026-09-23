'use client'

// framework
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'

// enums
import { FunnelSortKey, SortDir } from '@/enums/sort'

// types
import type { AgentFunnelRow, FunnelSort } from '@/types/funnel'

// lib
import { duration, full, hoursMinutes, money } from '@/lib/format'

// components
import { Icon } from '../ui/icons'

/** Every column reads from the left, heading and value on the same edge. */
const COLUMNS: { key: FunnelSortKey; label: string }[] = [
  { key: FunnelSortKey.Name, label: 'Agent' },
  { key: FunnelSortKey.Conversations, label: 'Conversations' },
  { key: FunnelSortKey.ReplyTime, label: 'Avg response' },
  { key: FunnelSortKey.OnlineTime, label: 'Online time' },
]

/** Solid brand colours for avatars: four blues and slate. */
const AVATAR_COLORS = ['#046bd2', '#045cb4', '#2f8fe0', '#0b3f82', '#475569']

/** A stable pick per agent, so the same person keeps the same tint between sorts. */
function gradientOf(name: string): string {
  return AVATAR_COLORS[[...name].reduce((sum, char) => sum + char.charCodeAt(0) * 7, 0) % AVATAR_COLORS.length]!
}

function AgentAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
      style={{ backgroundColor: gradientOf(name) }}
    >
      {initials}
    </span>
  )
}

/**
 * Per-agent table. Sortable via links that carry sort state
 * in the URL, so a view can be bookmarked and the back button walks through sorts.
 */
// Client component for the acknowledgement: the arrow moves and rows placeholder
// immediately on click, rather than the page looking unresponsive until the
// server replies.
export function AgentTable({
  agents,
  sort,
  sortHrefs,
}: {
  agents: AgentFunnelRow[]
  sort: FunnelSort
  /** Where each column heading points, built by the page from the current filters. */
  sortHrefs: Record<FunnelSortKey, string>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [shown, show] = useOptimistic(sort)

  function sortBy(key: FunnelSortKey, event: React.MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    const href = sortHrefs[key]
    // The direction the href encodes, not a guess: a column that is not sorted
    // starts in whichever direction the page decided reads best.
    const dir: SortDir = href.includes('dir=asc') ? SortDir.Asc : SortDir.Desc
    startTransition(() => {
      show({ key, dir })
      router.push(href, { scroll: false })
    })
  }

  if (agents.length === 0) {
    return (
      <div className="card p-10 text-center">
        <span className="icon-tile bg-accent-soft text-accent mx-auto mb-3 h-12 w-12">
          <Icon.Users className="h-5 w-5" />
        </span>
        <p className="font-medium">No agents yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          Agents appear here once they have an account in Chatwoot.
        </p>
      </div>
    )
  }

  return (
    // overflow-y-hidden stops a reserved vertical scrollbar gutter from separating the
    // header's grey band from the card's rounded edge; the two paddings clear the
    // horizontal scrollbar from the last row and the corners.
    <div className="card overflow-hidden pb-2">
      <div className="overflow-x-auto overflow-y-hidden pb-3">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="bg-surface-2/60 border-b border-line">
            {COLUMNS.map((column) => {
              const active = shown.key === column.key
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ? (shown.dir === SortDir.Asc ? 'ascending' : 'descending') : undefined}
                  className="eyebrow px-4 py-3 text-left"
                >
                  <span className="inline-flex items-center gap-1">
                    <Link
                      href={sortHrefs[column.key]}
                      onClick={(event) => sortBy(column.key, event)}
                      aria-busy={pending || undefined}
                      className={`hover:text-accent inline-flex items-center gap-1 rounded transition-colors duration-150 ${
                        active ? 'text-accent' : ''
                      }`}
                    >
                      {column.label}
                      <span
                        className={`inline-flex h-4 w-4 items-center justify-center rounded transition-opacity duration-150 ${
                          active ? 'bg-accent-soft opacity-100' : 'opacity-0'
                        }`}
                      >
                        {shown.dir === SortDir.Asc && active ? (
                          <Icon.SortUp className="h-3 w-3" />
                        ) : (
                          <Icon.SortDown className="h-3 w-3" />
                        )}
                      </span>
                    </Link>
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line" aria-busy={pending || undefined}>
          {pending
            ? // Same number of rows at the same height, so nothing under the
              // table shifts while the new order is on its way.
              agents.map((row) => (
                <tr key={row.id}>
                  {COLUMNS.map((column, index) => (
                    <td key={column.key} className="px-4 py-3">
                      <span className={`skeleton block h-4 ${index === 0 ? 'w-40' : 'w-16'}`} />
                    </td>
                  ))}
                </tr>
              ))
            : agents.map((row, index) => (
            <tr
              key={row.id}
              className="hover:bg-accent-soft/40 group transition-colors duration-150"
              style={{ ['--i' as string]: index }}
            >
              <td className="px-4 py-3 font-semibold">
                <span className="flex items-center gap-3">
                  <AgentAvatar name={row.name} />
                  <span className="truncate">{row.name}</span>
                </span>
              </td>
              <td className="tnum px-4 py-3">{full(row.conversations)}</td>
              {/* Period figures from the two charts below; a dash is "nothing to
                  show", not zero — no reply in the period, or nothing recorded. */}
              <td className={`tnum px-4 py-3 ${row.avgReplySeconds === null ? 'text-muted' : ''}`}>
                {duration(row.avgReplySeconds)}
              </td>
              <td className={`tnum px-4 py-3 ${row.onlineSeconds === null ? 'text-muted' : ''}`}>
                {hoursMinutes(row.onlineSeconds)}
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  )
}
