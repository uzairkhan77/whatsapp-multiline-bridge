// framework
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

// enums
import { LineHealth } from '@/enums/line-health'

// types
import type { ActivityRow } from '@/types/db'

// lib
import { requireUser } from '@/lib/auth'
import { full, prettyPhone, since } from '@/lib/format'
import { loadLine } from '@/lib/line-detail'
import { getChatwootSettings } from '@/lib/settings'

// components
import { VolumeChart } from '@/components/charts/VolumeChart'
import { PageHeader } from '@/components/layout/PageHeader'
import { LineActions } from '@/components/lines/LineActions'
import { StatusPill } from '@/components/ui/StatusPill'
import { Icon } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ instance: string }>
}): Promise<Metadata> {
  const { instance } = await params
  return { title: decodeURIComponent(instance) }
}

function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="border-b border-line py-2.5 last:border-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

function Toggle({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span
        className={
          on
            ? 'rounded-full bg-good-soft px-2 py-0.5 text-xs font-semibold text-good'
            : 'rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted'
        }
      >
        {on ? 'On' : 'Off'}
      </span>
    </span>
  )
}

/** The small heading row every card on this page opens with. */
function CardTitle({
  icon,
  tint = 'bg-accent-soft text-accent',
  children,
}: {
  icon: React.ReactNode
  tint?: string
  children: React.ReactNode
}) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold">
      <span className={`icon-tile h-7 w-7 rounded-lg ${tint}`}>{icon}</span>
      {children}
    </h2>
  )
}

/**
 * Chatwoot's own count for this line's inbox, awaited inside the page's Suspense
 * boundary so nothing else waits on it. Shows a dash rather than the bridge's own
 * total when unreadable — swapping between the two under one label was confusing.
 */
async function OpenConversations({ counts }: { counts: Promise<{ total: number; unassigned: number } | null> }) {
  const count = await counts
  if (!count) return <span className="text-muted">Chatwoot unavailable</span>
  return (
    <>
      <span className="tnum text-lg font-semibold">{full(count.total)}</span>
      {count.unassigned > 0 && (
        <span className="bg-warn-soft text-warn ml-2 rounded-full px-2 py-0.5 text-xs font-medium">
          {count.unassigned} unassigned
        </span>
      )}
    </>
  )
}

/** The gateway events this line's webhook is subscribed to, as small tags. */
function EventTags({ events }: { events: string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {events.map((event) => (
        <span key={event} className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">
          {event}
        </span>
      ))}
    </span>
  )
}

/** One row per message carried, newest first: direction, conversation, the line it actually left on, and when. */
function ActivityItem({ row, instance }: { row: ActivityRow; instance: string }) {
  const viaFallback = row.sentViaInstance !== null && row.sentViaInstance !== instance
  const inbound = row.direction === 'inbound'
  return (
    <li className="flex items-center gap-2.5 py-2 text-sm sm:gap-3">
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
          inbound ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted'
        }`}
        aria-hidden="true"
      >
        {inbound ? <Icon.In className="h-4 w-4" /> : <Icon.Out className="h-4 w-4" />}
      </span>
      <span className="w-18 shrink-0 capitalize">{row.direction}</span>
      <span className="tnum min-w-0 truncate text-muted">
        {row.chatwootConversationId ? `conversation ${row.chatwootConversationId}` : 'not delivered'}
      </span>
      {viaFallback && <span className="text-warn tnum shrink-0 text-xs">via {row.sentViaInstance}</span>}
      <span className="tnum ml-auto shrink-0 text-xs text-muted">{since(row.createdAt)}</span>
    </li>
  )
}

function ActivityList({ rows, instance }: { rows: ActivityRow[]; instance: string }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((row, index) => (
        <ActivityItem key={index} row={row} instance={instance} />
      ))}
    </ul>
  )
}

export default async function LinePage({ params }: { params: Promise<{ instance: string }> }) {
  await requireUser()

  const { instance } = await params
  const line = await loadLine(decodeURIComponent(instance))
  if (!line) notFound()

  // Read here rather than from env: the account can be changed on the Settings
  // screen while the panel runs, and a deep link into the wrong account opens a
  // real page — just not the one with this line's conversations in it.
  const chatwootSettings = await getChatwootSettings().catch(() => null)
  const chatwootUrl =
    line.config?.chatwootInboxId != null && chatwootSettings
      ? `${chatwootSettings.baseUrl}/app/accounts/${chatwootSettings.accountId}/inbox/${line.config.chatwootInboxId}`
      : null

  return (
    <div className="page page-narrow">
      <PageHeader
        eyebrow={
          <Link
            href="/"
            className="hover:text-accent inline-flex items-center gap-1.5 text-sm text-muted transition-colors duration-150"
          >
            <Icon.ArrowLeft className="h-3.5 w-3.5" />
            All lines
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="tnum">{line.instance}</span>
            <StatusPill health={line.health} />
          </span>
        }
        description={
          <span className="tnum">
            {prettyPhone(line.phone) ?? 'Not linked to a number yet'}
            {line.profileName && <span className="ml-2 font-sans">· {line.profileName}</span>}
          </span>
        }
        actions={
          <LineActions
            instance={line.instance}
            health={line.health}
            currentInboxId={line.config?.chatwootInboxId ?? null}
          />
        }
      />

      <main id="main" className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
        {/* Anything actionable goes above the reference data, full width. */}
        {line.health === LineHealth.Connecting && (
          <p className="callout callout-warn reveal lg:col-span-3" style={{ ['--i' as string]: 1 }}>
            <Icon.Qr className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              A QR code has been generated and is waiting to be scanned. This line stays offline
              until someone scans it — nothing here resolves on its own.
            </span>
          </p>
        )}

        {line.reason && line.health !== LineHealth.Connecting && (
          <p className="callout callout-danger reveal lg:col-span-3" style={{ ['--i' as string]: 1 }}>
            <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {line.reason}
              {since(line.disconnectedAt) && (
                <span className="opacity-75"> · {since(line.disconnectedAt)}</span>
              )}
            </span>
          </p>
        )}

        {/* The failure this page exists to make visible. A line can be perfectly
            connected to WhatsApp and still deliver to nobody, and nothing else on
            the dashboard would show it. */}
        {line.config && !line.webhookMatchesLine && (
          <p className="callout callout-danger reveal lg:col-span-3" style={{ ['--i' as string]: 1 }}>
            <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {line.webhook
                ? 'Messages on this number are being delivered to the wrong address, so they are not reaching Chatwoot.'
                : 'Messages on this number are not reaching Chatwoot.'}{' '}
              This needs a technical fix — contact support.
            </span>
          </p>
        )}

        <section className="card reveal p-4 sm:p-5 lg:col-span-2" style={{ ['--i' as string]: 2 }}>
          <div className="mb-4">
            <CardTitle icon={<Icon.Activity className="h-3.5 w-3.5" />}>
              Message volume · 14 days
            </CardTitle>
          </div>
          <VolumeChart data={line.volume} />
        </section>

        <section className="card reveal p-4 sm:p-5" style={{ ['--i' as string]: 3 }}>
          <div className="mb-1">
            <CardTitle icon={<Icon.Chat className="h-3.5 w-3.5" />} tint="bg-accent-soft text-accent">
              Totals
            </CardTitle>
          </div>
          <dl>
            <Field label="Received">
              <span className="tnum text-lg font-semibold">{full(line.inbound)}</span>
            </Field>
            <Field label="Sent">
              <span className="tnum text-lg font-semibold">{full(line.outbound)}</span>
            </Field>
            <Field label="Open conversations" hint="From Chatwoot">
              <Suspense fallback={<span className="skeleton inline-block h-5 w-12 rounded align-middle" />}>
                <OpenConversations counts={line.openConversations} />
              </Suspense>
            </Field>
            <Field label="Last message">
              {since(line.lastActivity) ?? <span className="text-muted">Never</span>}
            </Field>
          </dl>
        </section>

        <section className="card reveal p-4 sm:p-5" style={{ ['--i' as string]: 4 }}>
          <div className="mb-1">
            <CardTitle icon={<Icon.Link className="h-3.5 w-3.5" />}>Wiring</CardTitle>
          </div>
          <dl>
            <Field label="Chatwoot inbox">
              {chatwootUrl && line.config ? (
                <a
                  href={chatwootUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent tnum inline-flex items-center gap-1 hover:underline"
                >
                  {line.config.chatwootInboxId}
                  <Icon.External className="h-3.5 w-3.5" />
                </a>
              ) : (
                <span className="text-warn">No inbox assigned — messages are dropped</span>
              )}
            </Field>
            <Field
              label="Fallback line"
              hint={
                line.config && !line.config.fallbackInstance
                  ? 'Outbound fails rather than going out from a number the customer does not recognise'
                  : undefined
              }
            >
              {line.config?.fallbackInstance ? (
                <Link
                  href={`/lines/${encodeURIComponent(line.config.fallbackInstance)}`}
                  className="text-accent tnum hover:underline"
                >
                  {line.config.fallbackInstance}
                </Link>
              ) : (
                <span className="text-muted">None</span>
              )}
            </Field>
            <Field label="In service">
              {line.config?.enabled === false ? (
                <span className="text-muted">No — taken out of service</span>
              ) : (
                <span className="text-good">Yes</span>
              )}
            </Field>
            <Field label="Created">
              {line.createdAt ? since(line.createdAt) : <span className="text-muted">—</span>}
            </Field>
          </dl>
        </section>

        <section className="card reveal p-4 sm:p-5" style={{ ['--i' as string]: 5 }}>
          <div className="mb-1">
            <CardTitle icon={<Icon.Out className="h-3.5 w-3.5" />} tint="bg-surface-2 text-muted">
              Webhook
            </CardTitle>
          </div>
          <dl>
            <Field label="Delivering to">
              {line.webhook ? (
                <code className="block rounded-lg border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs break-all">
                  {line.webhook.url}
                </code>
              ) : (
                <span className="text-danger">Not registered</span>
              )}
            </Field>
            <Field label="Events">
              {line.webhook?.events.length ? (
                <EventTags events={line.webhook.events} />
              ) : (
                <span className="text-muted">—</span>
              )}
            </Field>
          </dl>
        </section>

        <section className="card reveal p-4 sm:p-5" style={{ ['--i' as string]: 6 }}>
          <div className="mb-2">
            <CardTitle icon={<Icon.Gear className="h-3.5 w-3.5" />} tint="bg-surface-2 text-muted">
              WhatsApp settings
            </CardTitle>
          </div>
          {line.settings ? (
            <div className="flex flex-col">
              <Toggle on={line.settings.rejectCall} label="Reject calls" />
              <Toggle on={line.settings.groupsIgnore} label="Ignore groups" />
              <Toggle on={line.settings.alwaysOnline} label="Always online" />
              <Toggle on={line.settings.readMessages} label="Mark read" />
              <Toggle on={line.settings.syncFullHistory} label="Sync full history" />
            </div>
          ) : (
            <p className="text-sm text-muted">No settings — this WhatsApp line no longer exists.</p>
          )}
        </section>

        <section className="card reveal p-4 sm:p-5 lg:col-span-2" style={{ ['--i' as string]: 7 }}>
          <div className="mb-1">
            <CardTitle icon={<Icon.Clock className="h-3.5 w-3.5" />}>Recent activity</CardTitle>
          </div>
          <p className="mb-3 text-xs text-muted">
            Identifiers and timestamps only. Message text lives in Chatwoot and is deliberately not
            copied here.
          </p>

          {line.activity.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line py-6 text-center text-sm text-muted">
              Nothing has passed through this line yet.
            </p>
          ) : (
            <ActivityList rows={line.activity} instance={line.instance} />
          )}
        </section>
      </main>
    </div>
  )
}
