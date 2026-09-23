// framework
import Link from 'next/link'
import { Suspense } from 'react'

// enums
import { LineHealth } from '@/enums/line-health'

// types
import type { InboxCount, LineView } from '@/types/dashboard'

// lib
import { full, prettyPhone, since } from '@/lib/format'

// components
import { Icon } from '../ui/icons'
import { StatusPill } from '../ui/StatusPill'
import { LineActions } from './LineActions'

/** Solid brand colours for avatars: four blues and slate. */
const AVATAR_COLORS = ['#046bd2', '#045cb4', '#2f8fe0', '#0b3f82', '#475569']

/**
 * Initials, not the WhatsApp profile picture: those URLs are signed and expire,
 * and loading them tells WhatsApp's CDN who is watching this dashboard.
 */
function Avatar({ line }: { line: LineView }) {
  // Derived from the line name, not the WhatsApp profile name (owner-set, changes
  // without warning). Lines are named in a series (line-test-01, …), so the trailing
  // number distinguishes them better than initials would; initials are the fallback.
  const trailing = /(\d{1,3})$/.exec(line.instance)
  const initials =
    trailing?.[1] ??
    line.instance
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join('')

  // Stable pick from the brand palette per line, so the same number keeps the same
  // colour across refreshes. Curated list, not a random hue — random hues land on
  // colours the brand never uses.
  const gradient = AVATAR_COLORS[[...line.instance].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_COLORS.length]!

  return (
    <div
      className="tnum grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-sm font-bold text-white shadow-md"
      style={{ backgroundColor: gradient }}
      aria-hidden="true"
    >
      {initials || '??'}
    </div>
  )
}

/**
 * Chatwoot's open-conversation count, awaited here (not in the page) so the rest
 * of the card paints first. Not the bridge's own count — that's a different figure.
 */
async function OpenConversations({ counts, inboxId }: { counts: Promise<Map<number, InboxCount>>; inboxId: number | null }) {
  if (inboxId === null) {
    return (
      <span className="text-muted-2" title="No Chatwoot inbox is assigned to this line">
        —
      </span>
    )
  }
  const count = (await counts).get(inboxId)
  if (count === undefined) {
    return (
      <span className="text-muted-2" title="Chatwoot could not be read">
        —
      </span>
    )
  }
  return <>{full(count.total)}</>
}

async function Unassigned({ counts, inboxId }: { counts: Promise<Map<number, InboxCount>>; inboxId: number | null }) {
  const count = inboxId === null ? undefined : (await counts).get(inboxId)
  if (!count?.unassigned) return null
  return (
    <span className="bg-warn-soft text-warn inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium">
      {count.unassigned} unassigned
    </span>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-surface-2/70 rounded-xl px-3 py-2.5">
      <dt className="eyebrow flex items-center gap-1">
        <span className="opacity-70">{icon}</span>
        {label}
      </dt>
      <dd className="tnum mt-1 text-lg leading-tight font-bold">{value}</dd>
    </div>
  )
}

export function LineCard({
  line,
  index,
  chatwootCounts,
}: {
  line: LineView
  index: number
  chatwootCounts: Promise<Map<number, InboxCount>>
}) {
  const needsAttention =
    line.health === LineHealth.Down || line.health === LineHealth.Unconfigured || line.health === LineHealth.Missing

  return (
    <article
      className={`card card-hover reveal flex flex-col gap-4 overflow-hidden p-4 sm:p-5 ${
        needsAttention ? 'ring-danger/25 ring-2 ring-offset-0' : ''
      }`}
      // A short stagger down the grid, capped hard: the last card in a long list
      // must not be waiting a visible beat to appear on a screen people scan.
      style={{ ['--i' as string]: Math.min(index, 6) + 5 }}
    >
      <header className="flex items-start gap-3">
        <Avatar line={line} />
        <div className="min-w-0 flex-1">
          {/* The name is the link, not the card: nesting the card's buttons inside a
              link would give keyboard users an unreachable control. */}
          <h3 className="truncate text-[15px] font-bold tracking-tight">
            <Link
              href={`/lines/${encodeURIComponent(line.instance)}`}
              className="tnum hover:text-accent rounded transition-colors duration-150"
            >
              {line.instance}
            </Link>
          </h3>
          <p className="tnum truncate text-sm font-medium text-muted">
            {prettyPhone(line.phone) ?? 'Not linked to a number yet'}
          </p>
          {line.profileName && <p className="truncate text-xs text-muted-2">{line.profileName}</p>}
        </div>
        <StatusPill health={line.health} />
      </header>

      {/* Waiting-to-scan isn't a failure (no red treatment), but it won't recover on
          its own, so we say so. */}
      {line.health === LineHealth.Connecting ? (
        <p className="callout callout-warn text-xs">
          <Icon.Qr className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            A QR code is waiting to be scanned. This number stays offline until someone scans it
            with the phone.
          </span>
        </p>
      ) : (
        // The failure, in words, sitting where the eye already is. A raw code here
        // would send the operator to a search engine mid-incident.
        line.reason && (
          <p className="callout callout-danger text-xs">
            <Icon.Warning className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {line.reason}
              {since(line.disconnectedAt) && (
                <span className="opacity-75"> · {since(line.disconnectedAt)}</span>
              )}
            </span>
          </p>
        )
      )}

      {line.health === LineHealth.Unconfigured && (
        <p className="callout callout-warn text-xs">
          <Icon.Warning className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Connected to WhatsApp, but no Chatwoot inbox is assigned to it — so messages this
            number receives have nowhere to go and are dropped. Use “Assign inbox” below to
            start routing.
          </span>
        </p>
      )}

      {line.health === LineHealth.Missing && (
        <p className="callout callout-warn text-xs">
          <Icon.Warning className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>Routed to a Chatwoot inbox, but the WhatsApp line no longer exists.</span>
        </p>
      )}

      <dl className="mt-1 grid grid-cols-3 gap-2">
        <Metric icon={<Icon.In className="h-3 w-3" />} label="In" value={full(line.inbound)} />
        <Metric icon={<Icon.Out className="h-3 w-3" />} label="Out" value={full(line.outbound)} />
        <Metric
          icon={<Icon.Chat className="h-3 w-3" />}
          label="Open chats"
          value={
            <Suspense fallback={<span className="skeleton inline-block h-4 w-10 rounded align-middle" />}>
              <OpenConversations counts={chatwootCounts} inboxId={line.chatwootInboxId} />
            </Suspense>
          }
        />
      </dl>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {line.lastActivity && (
          <span className="inline-flex items-center gap-1">
            <Icon.Clock className="h-3 w-3" />
            Last message {since(line.lastActivity)}
          </span>
        )}
        {line.fallbackInstance && (
          <span className="inline-flex items-center gap-1">
            <Icon.Link className="h-3 w-3" />
            Falls back to <span className="tnum text-fg">{line.fallbackInstance}</span>
          </span>
        )}
        {line.chatwootInboxId && (
          <span className="tnum inline-flex items-center gap-1">Inbox {line.chatwootInboxId}</span>
        )}
        <Suspense fallback={null}>
          <Unassigned counts={chatwootCounts} inboxId={line.chatwootInboxId} />
        </Suspense>
      </div>

      <footer className="mt-auto border-t border-line pt-4">
        <LineActions
          instance={line.instance}
          health={line.health}
          currentInboxId={line.chatwootInboxId}
        />
      </footer>
    </article>
  )
}
