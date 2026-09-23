'use client'

// framework
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from 'recharts'

// types
import type { OnlineTotal } from '@/types/agent-days'

// lib
import { hoursMinutes, periodLabel, shortDay } from '@/lib/format'

// components
import { CHART, Legend, TooltipCard, agentColor, barRadius, dayTick, valueTick } from './chart-utils'

const HOUR = 3600

/**
 * Total Online time per agent over the selected period, one bar per agent
 * (colour-matched to the reply chart above).
 */
export function OnlineTimeChart({
  data,
  since,
  range,
}: {
  data: OnlineTotal[]
  since: string | null
  /** First and last day shown, YYYY-MM-DD, both inclusive. */
  range: { from: string; to: string }
}) {
  const seen = data.filter((agent) => agent.recordedDays > 0)
  if (seen.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No readings in this period yet.</p>
  }

  // Whole hours on the axis: the longest total rounded up to an even number of
  // hours, at least two, and the ticks quarter it.
  const topHours = Math.max(2, 2 * Math.ceil(Math.max(...data.map((agent) => agent.online)) / HOUR / 2))
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(topHours * f * HOUR)))]
  const teamTotal = data.reduce((sum, agent) => sum + agent.online, 0)

  return (
    <figure className="m-0">
      <div className="h-56 sm:h-72" role="img" aria-label={`Total Online time per agent over the selected period.`}>
        <BarChart
          responsive
          data={data}
          margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="30%"
          style={{ width: '100%', height: '100%' }}
        >
          <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
          <XAxis dataKey="name" interval={0} axisLine={false} tickLine={false} tick={dayTick} tickMargin={8} />
          <YAxis
            domain={[0, topHours * HOUR]}
            ticks={ticks}
            tickFormatter={(value: number) => `${Math.round(value / HOUR)}h`}
            width={32}
            axisLine={false}
            tickLine={false}
            tick={valueTick}
          />
          <Tooltip
            cursor={{ fill: CHART.hover }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const agent = payload?.[0]?.payload as OnlineTotal | undefined
              if (!active || !agent) return null
              const color = agentColor(data.findIndex((row) => row.id === agent.id))
              return (
                <TooltipCard
                  title={agent.name}
                  rows={[
                    { label: 'Online', value: hoursMinutes(agent.online), color },
                    { label: 'Busy', value: hoursMinutes(agent.busy), color: CHART.lightBlue },
                    { label: 'Days recorded', value: String(agent.recordedDays), color: CHART.grid },
                  ]}
                />
              )
            }}
          />
          <Bar dataKey="online" name="Online" radius={barRadius} maxBarSize={44} animationDuration={700}>
            {data.map((agent, index) => (
              <Cell key={agent.id} fill={agentColor(index)} />
            ))}
          </Bar>
        </BarChart>
      </div>

      <Legend
        items={[{ label: 'Team total', value: hoursMinutes(teamTotal), color: CHART.blue }]}
        note={`${periodLabel(range.from, range.to)}${since ? ` · recorded since ${shortDay(since)}` : ''}`}
      />
    </figure>
  )
}
