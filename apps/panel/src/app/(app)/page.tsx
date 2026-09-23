// framework
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'

// enums
import { LineHealth } from '@/enums/line-health'

// types
import type { Dashboard, LineView } from '@/types/dashboard'

// lib
import { requireUser } from '@/lib/auth'
import { loadDashboard } from '@/lib/dashboard'
import { compact, full } from '@/lib/format'

// components
import { VolumeChart } from '@/components/charts/VolumeChart'
import { PageHeader } from '@/components/layout/PageHeader'
import { AddLine } from '@/components/lines/AddLine'
import { HideWhileDeleting } from '@/components/lines/HideWhileDeleting'
import { LineCard } from '@/components/lines/LineCard'
import { RefreshBar } from '@/components/lines/RefreshBar'
import { Callout } from '@/components/ui/Callout'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatCard } from '@/components/ui/StatCard'
import { Icon } from '@/components/ui/icons'
import { PageHeaderSkeleton } from '@/components/ui/skeletons'

export const metadata: Metadata = { title: 'Lines' }

// Never cached. Every value on this page is a live operational reading, and a
// stale "Connected" is the one answer this screen must never give.
export const dynamic = 'force-dynamic'

/** line-test-01, line-test-02 … suggest the next in whatever series is already there. */
function suggestName(existing: string[]): string {
  const numbered = existing
    .map((name) => /^(.*?)(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)

  if (numbered.length === 0) return 'line-01'
  const last = numbered[numbered.length - 1]!
  const width = last[2]!.length
  const next = Math.max(...numbered.map((m) => Number(m[2]))) + 1
  return `${last[1]}${String(next).padStart(width, '0')}`
}

/**
 * Renders inside its own Suspense boundary, not loading.tsx — as the index
 * route of (app), a loading.tsx here would be the fallback for every screen.
 */
export default async function DashboardPage() {
  // Before any data is read. The middleware redirects a signed-out visitor before
  // this runs, but a page that loads live operational readings should not depend on
  // a redirect elsewhere to decide whether it is allowed to load them.
  await requireUser()

  return (
    <Suspense fallback={<LinesSkeleton />}>
      <Dashboard />
    </Suspense>
  )
}

/** `count` grey tiles of one height, standing in for cards that are still loading. */
function SkeletonTiles({ count, height }: { count: number; height: string }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className={`skeleton ${height} rounded-[var(--radius-card)]`} />
  ))
}

function LinesSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <PageHeaderSkeleton title="w-28" description="w-[30rem]" actions />

      <div className="mb-gutter grid grid-cols-2 gap-gutter sm:grid-cols-3">
        <SkeletonTiles count={3} height="h-[7.5rem]" />
      </div>

      <div className="skeleton mb-gutter h-[17rem] rounded-[var(--radius-card)]" />

      <div className="skeleton mb-3 h-4 w-28 rounded" />
      <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">
        <SkeletonTiles count={3} height="h-[19rem]" />
      </div>

      <span className="sr-only" role="status">
        Loading line status
      </span>
    </div>
  )
}

/** Which lines are not carrying traffic, each a link to its page. Above the metrics: a number that is down matters more than any total. */
function AttentionCallout({ lines }: { lines: LineView[] }) {
  return (
    <Callout tone="danger">
      <span className="font-semibold">
        {lines.length} {lines.length === 1 ? 'line needs' : 'lines need'} attention
      </span>
      <span className="opacity-60"> — </span>
      <span className="tnum">
        {lines.map((line, index) => (
          <span key={line.instance}>
            {index > 0 && ', '}
            <Link href={`/lines/${encodeURIComponent(line.instance)}`} className="underline underline-offset-2">
              {line.instance}
            </Link>
          </span>
        ))}
      </span>
    </Callout>
  )
}

function LineGrid({ lines, chatwootCounts }: { lines: LineView[]; chatwootCounts: Dashboard['chatwootCounts'] }) {
  return (
    <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">
      {lines.map((line, index) => (
        <HideWhileDeleting key={line.instance} instance={line.instance}>
          <LineCard line={line} index={index} chatwootCounts={chatwootCounts} />
        </HideWhileDeleting>
      ))}
    </div>
  )
}

async function Dashboard() {
  const { lines, chatwootCounts, volume, degraded, gatewayReachable, generatedAt } = await loadDashboard()

  const up = lines.filter((line) => line.health === LineHealth.Up).length
  const attention = lines.filter(
    (line) => line.health === LineHealth.Down || line.health === LineHealth.Unconfigured || line.health === LineHealth.Missing,
  )
  const inbound = lines.reduce((sum, line) => sum + line.inbound, 0)
  const outbound = lines.reduce((sum, line) => sum + line.outbound, 0)

  return (
    <div className="page">
      <PageHeader
        title="Lines"
        description="WhatsApp numbers, their connection state, and what has moved through them"
        actions={
          <>
            <RefreshBar generatedAt={generatedAt} />
            <AddLine suggestion={suggestName(lines.map((line) => line.instance))} />
          </>
        }
      />

      <main id="main">
        {attention.length > 0 && <AttentionCallout lines={attention} />}
        {degraded.length > 0 && <Callout>Showing what could be read. {degraded.join('. ')}.</Callout>}

        {/* Conversations and first-reply time live on the Funnel instead:
            those are team-performance metrics; this screen only answers whether
            numbers are up and traffic is moving. */}
        <section aria-label="Summary" className="mb-gutter grid grid-cols-2 gap-gutter sm:grid-cols-3">
          {/* Healthy is the normal state, so it reads in the panel's own blue and
              black like every other tile; red is kept for a line actually down. */}
          <StatCard
            index={1}
            label="Lines up"
            value={gatewayReachable ? `${up}/${lines.length}` : '—'}
            hint={
              gatewayReachable
                ? up === lines.length
                  ? 'All numbers connected'
                  : `${lines.length - up} not connected`
                : 'WhatsApp service unreachable'
            }
            tone={gatewayReachable && up === lines.length ? 'default' : 'bad'}
            icon={<Icon.Connected className="h-4.5 w-4.5" />}
          />
          <StatCard
            index={2}
            label="Received"
            value={compact(inbound)}
            hint={`${full(inbound)} messages`}
            tint="accent"
            icon={<Icon.In className="h-4.5 w-4.5" />}
            spark={volume.map((day) => day.inbound)}
          />
          <StatCard
            index={3}
            label="Sent"
            value={compact(outbound)}
            hint={`${full(outbound)} messages`}
            tint="teal"
            icon={<Icon.Out className="h-4.5 w-4.5" />}
            spark={volume.map((day) => day.outbound)}
          />
        </section>

        <section aria-label="Message volume" className="card reveal mb-gutter p-4 sm:p-5" style={{ ['--i' as string]: 4 }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Message volume</h2>
              <p className="text-xs text-muted">Last 14 days, across every line</p>
            </div>
            <span className="bg-surface-2 text-muted rounded-full px-2.5 py-1 text-[11px] font-medium">
              Daily
            </span>
          </div>
          <VolumeChart data={volume} />
        </section>

        <section aria-label="Lines" className="reveal" style={{ ['--i' as string]: 5 }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              All lines <span className="tnum font-normal text-muted">({lines.length})</span>
            </h2>
          </div>

          {lines.length === 0 ? (
            <EmptyState icon={<Icon.Qr className="h-5 w-5" />} title="No lines yet">
              {gatewayReachable
                ? 'Add a line, then scan the QR with the phone that owns the number.'
                : 'The WhatsApp connection service is not answering, so no lines can be shown. Try again in a minute.'}
            </EmptyState>
          ) : (
            <LineGrid lines={lines} chatwootCounts={chatwootCounts} />
          )}
        </section>
      </main>

      <footer className="mt-8 border-t border-line pt-4 text-xs text-muted">
        Message counts are kept by this system and by Chatwoot. Message text is never stored.
      </footer>
    </div>
  )
}
