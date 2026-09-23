// framework
import type { Metadata } from 'next'

// enums
import { FunnelSource } from '@/enums/funnel-source'
import { Period } from '@/enums/period'
import { FunnelSortKey, SortDir } from '@/enums/sort'

// lib
import { onlineTotals, replySeries } from '@/lib/agent-days'
import { requireUser } from '@/lib/auth'
import { BUSINESS_TIMEZONE_LABEL } from '@/lib/business-time'
import { compact, duration, shortDay } from '@/lib/format'
import { loadFunnel } from '@/lib/funnel'

// components
import { OnlineTimeChart } from '@/components/charts/OnlineTimeChart'
import { ReplyTimeChart } from '@/components/charts/ReplyTimeChart'
import { TrendChart } from '@/components/charts/TrendChart'
import { AgentTable } from '@/components/funnel/AgentTable'
import { FunnelFilters } from '@/components/funnel/FunnelFilters'
import { FunnelSync } from '@/components/funnel/FunnelSync'
import { PageHeader } from '@/components/layout/PageHeader'
import { Callout } from '@/components/ui/Callout'
import { InfoTooltip } from '@/components/ui/InfoTooltip'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatCard } from '@/components/ui/StatCard'
import { Icon } from '@/components/ui/icons'

export const metadata: Metadata = { title: 'Funnel' }

// Same reasoning as the Lines dashboard: every figure here is a live reading for a
// given filter combination, not something that should be served from a cache.
export const dynamic = 'force-dynamic'

// The button that refreshes Chatwoot data from scratch can read pages for most
// of a minute. This is the ceiling asked of the platform; reads themselves stop
// short of it and save progress as they go.
export const maxDuration = 60

const VALID_SORT_KEYS: FunnelSortKey[] = Object.values(FunnelSortKey)

/** Said beside both day-by-day tables whenever a line is picked — see assembleAgentDays in lib/funnel.ts. */
const LINE_FILTER_DOES_NOT_APPLY =
  'Not affected by the line filter — response and online time are per agent across all lines.'

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireUser()

  const params = await searchParams
  const periodParam = one(params.period)
  const period: Period = Object.values(Period).includes(periodParam as Period)
    ? (periodParam as Period)
    : Period.Days14
  const from = one(params.from)
  const to = one(params.to)
  const instance = one(params.instance) ?? 'all'
  const sortParam = one(params.sort)
  const sortKey: FunnelSortKey = VALID_SORT_KEYS.includes(sortParam as FunnelSortKey)
    ? (sortParam as FunnelSortKey)
    : FunnelSortKey.Conversations
  const sortDir: SortDir = one(params.dir) === SortDir.Asc ? SortDir.Asc : SortDir.Desc
  // Until the copy has proved itself the figures can be read either way, so the
  // two can be put side by side. Only the URL can ask; the default is the deploy's.
  const sourceParam = one(params.source)
  const source: FunnelSource | undefined =
    Object.values(FunnelSource).includes(sourceParam as FunnelSource) ? (sourceParam as FunnelSource) : undefined

  const funnel = await loadFunnel(
    { period, from, to, instance: instance === 'all' ? undefined : instance },
    { key: sortKey, dir: sortDir },
    source,
  )

  function makeSortHref(key: FunnelSortKey): string {
    const next = new URLSearchParams()
    if (period !== Period.Days14) next.set('period', period)
    if (from) next.set('from', from)
    if (to) next.set('to', to)
    if (instance !== 'all') next.set('instance', instance)
    if (source) next.set('source', source)
    next.set('sort', key)
    next.set('dir', sortKey === key && sortDir === SortDir.Desc ? SortDir.Asc : SortDir.Desc)
    return `/funnel?${next.toString()}`
  }

  const { summary, agentDays } = funnel

  return (
    <div className="page">
      <PageHeader
        title="Funnel"
        description="How much the team handled, and how quickly they answered"
        actions={<FunnelSync asOf={funnel.asOf} history={funnel.history} source={funnel.source} />}
      />

      <main id="main">
        {funnel.degraded.length > 0 && <Callout>{funnel.degraded.join('. ')}.</Callout>}

        <div className="reveal mb-gutter" style={{ ['--i' as string]: 1 }}>
          <FunnelFilters
            period={period}
            from={from}
            to={to}
            instance={instance}
            lines={funnel.lines.map((line) => line.instance)}
          />
        </div>

        {funnel.range.clamped && (
          <p className="reveal mb-gutter text-xs text-muted" style={{ ['--i' as string]: 1 }}>
            Showing {shortDay(funnel.range.from)} onward — conversation history starts there.
          </p>
        )}

        {/* One palette across the row: the two blues alternate, icon tile and
            sparkline together, and every figure is plain black. A tile that broke
            colour would read as a warning about that number, which none of these are. */}
        <section aria-label="Summary" className="mb-gutter grid grid-cols-2 gap-gutter lg:grid-cols-3">
          <StatCard
            index={2}
            label="Conversations started"
            value={compact(summary.conversationsStarted)}
            hint={`${compact(summary.conversationsAssigned)} assigned to an agent`}
            tint="accent"
            icon={<Icon.Chat className="h-4.5 w-4.5" />}
            spark={funnel.trend.map((day) => day.conversations)}
          />
          <StatCard
            index={3}
            label="Agents active"
            value={compact(funnel.agents.filter((agent) => agent.conversations > 0).length)}
            hint={`of ${funnel.agents.length} on the team`}
            tint="teal"
            icon={<Icon.Users className="h-4.5 w-4.5" />}
          />
          <StatCard
            index={4}
            label="Avg response"
            value={duration(summary.avgReplySeconds)}
            hint="across every agent who replied"
            tint="accent"
            icon={<Icon.Clock className="h-4.5 w-4.5" />}
          />
        </section>

        {/* An explicit empty state, since a period with no
            conversations is expected early on — zeros and dashes would read as
            a broken screen. */}
        {summary.conversationsStarted === 0 && funnel.history === null ? (
          <EmptyState icon={<Icon.Chat className="h-5 w-5" />} title="No conversations in this period" index={8}>
            {instance === 'all'
              ? 'Nothing was started on any line in the selected dates. Widen the period to see earlier activity.'
              : `Nothing was started on ${instance} in the selected dates. Try all lines, or widen the period.`}
          </EmptyState>
        ) : (
          <>
            <section aria-label="Trend" className="card reveal mb-gutter p-4 sm:p-5" style={{ ['--i' as string]: 8 }}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Conversations per day</h2>
                  <p className="text-xs text-muted">Daily, over the selected period. Days run midnight to midnight, {BUSINESS_TIMEZONE_LABEL}.</p>
                </div>
                <span className="bg-surface-2 text-muted rounded-full px-2.5 py-1 text-[11px] font-medium">
                  {funnel.trend.length} {funnel.trend.length === 1 ? 'day' : 'days'}
                </span>
              </div>
              <TrendChart data={funnel.trend} />
            </section>

            <section aria-label="Per-agent performance" className="reveal" style={{ ['--i' as string]: 9 }}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    By agent <span className="tnum font-normal text-muted">({funnel.agents.length})</span>
                  </h2>
                  <p className="text-xs text-muted">Click a column to sort.</p>
                </div>
              </div>
              <AgentTable
                agents={funnel.agents}
                sort={{ key: sortKey, dir: sortDir }}
                sortHrefs={Object.fromEntries(VALID_SORT_KEYS.map((key) => [key, makeSortHref(key)])) as Record<FunnelSortKey, string>}
              />
            </section>
          </>
        )}

        {/* Outside the empty-state branch above on purpose: a fortnight with no
            conversations still had agents Online, and their reply times on
            other days are still worth a look. */}
        {agentDays && agentDays.agents.length > 0 && (
          <>
            <section aria-label="Response time by day" className="card reveal mt-gutter p-4 sm:p-5" style={{ ['--i' as string]: 10 }}>
              <div className="mb-4">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  Response time
                  <InfoTooltip text="Average time from a customer's message to the agent's next reply, over every reply that day. From Chatwoot's reports; days run midnight to midnight, the business timezone." />
                </h2>
                <p className="text-xs text-muted">One line per agent, daily. Every reply, not only the first.</p>
                {agentDays.lineFilterIgnored && <p className="text-xs text-muted">{LINE_FILTER_DOES_NOT_APPLY}</p>}
              </div>
              {agentDays.reply === null ? (
                <p className="py-10 text-center text-sm text-muted">
                  Response times could not be read from Chatwoot. Refresh in a minute.
                </p>
              ) : (
                <ReplyTimeChart data={replySeries(agentDays)} agents={agentDays.agents} />
              )}
            </section>

            {!agentDays.presenceMissing && (
              <section aria-label="Online time by day" className="card reveal mt-gutter p-4 sm:p-5" style={{ ['--i' as string]: 11 }}>
                <div className="mb-4">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                    Online time
                    <InfoTooltip text="How long each agent's Chatwoot status was Online across the selected period, from a status reading taken every fifteen minutes. Busy time is in the readout over each bar. This is the status they set in Chatwoot, not whether they were at their desk." />
                  </h2>
                  <p className="text-xs text-muted">Total time Online over the selected period, one bar per agent.</p>
                  {agentDays.lineFilterIgnored && <p className="text-xs text-muted">{LINE_FILTER_DOES_NOT_APPLY}</p>}
                </div>
                {agentDays.presence === null ? (
                  <p className="py-10 text-center text-sm text-muted">Online time could not be read. Refresh in a minute.</p>
                ) : (
                  <OnlineTimeChart data={onlineTotals(agentDays)} since={agentDays.presence.since} range={funnel.range} />
                )}
              </section>
            )}
          </>
        )}
      </main>

      <footer className="mt-8 border-t border-line pt-4 text-xs text-muted">
        Conversations from Chatwoot over {shortDay(funnel.range.from)} to {shortDay(funnel.range.to)},
        with every day running midnight to midnight, {BUSINESS_TIMEZONE_LABEL}. Response times from
        Chatwoot's reports; online time from a status reading taken every fifteen minutes.
      </footer>
    </div>
  )
}
