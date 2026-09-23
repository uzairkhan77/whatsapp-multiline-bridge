'use client'

// framework
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'

// types
import type { AgentSeriesPoint } from '@/types/agent-days'

// lib
import { replyAxis, rungLabel } from '@/lib/agent-days'
import { duration, shortDay } from '@/lib/format'

// components
import { CHART, Legend, TooltipCard, agentColor, dayTick, everyDay, valueTick } from './chart-utils'

/**
 * Average reply time per agent, one line each. A line (not bars) shows who's
 * trending slower; a gap means no reply that day, not zero.
 */
export function ReplyTimeChart({ data, agents }: { data: AgentSeriesPoint[]; agents: { id: number; name: string }[] }) {
  const values = data.flatMap((point) => agents.map((agent) => point[String(agent.id)])).filter(
    (value): value is number => typeof value === 'number',
  )
  if (values.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No replies in this period yet.</p>
  }

  // Log axis: reply times span minutes to most of a day; a linear axis would let
  // one bad afternoon flatten every other line. Rungs are recognisable times (5m, 15m, 1h, 4h).
  const axis = replyAxis(Math.min(...values), Math.max(...values))

  // Legend shows each agent's mean over the days they replied — a plain average of
  // daily averages, consistent with what the line itself shows.
  const legend = agents.map((agent, index) => {
    const days = data.map((point) => point[String(agent.id)]).filter((v): v is number => typeof v === 'number')
    const mean = days.length > 0 ? days.reduce((sum, v) => sum + v, 0) / days.length : null
    return { label: agent.name, value: duration(mean), color: agentColor(index) }
  })

  return (
    <figure className="m-0">
      <div className="h-56 sm:h-80" role="img" aria-label={`Average reply time per agent over ${data.length} days.`}>
        <LineChart responsive data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} style={{ width: '100%', height: '100%' }}>
          <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            ticks={everyDay(data)}
            tickFormatter={shortDay}
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={dayTick}
            tickMargin={8}
          />
          <YAxis
            scale="log"
            domain={[axis.floor, axis.ceil]}
            ticks={axis.ticks}
            tickFormatter={rungLabel}
            width={40}
            axisLine={false}
            tickLine={false}
            tick={valueTick}
          />
          <Tooltip
            cursor={{ stroke: CHART.grid }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as AgentSeriesPoint | undefined
              if (!active || !point) return null
              const rows = agents.flatMap((agent, index) => {
                const value = point[String(agent.id)]
                return typeof value === 'number' ? [{ label: agent.name, value: duration(value), color: agentColor(index) }] : []
              })
              return <TooltipCard title={shortDay(point.day)} rows={rows.length > 0 ? rows : [{ label: 'No replies', value: '—', color: CHART.grid }]} />
            }}
          />
          {agents.map((agent, index) => (
            <Line
              key={agent.id}
              type="monotone"
              dataKey={String(agent.id)}
              name={agent.name}
              stroke={agentColor(index)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </div>

      <Legend items={legend} note="A gap is a day with no reply. Legend figures are each agent's average over the days they replied on" />
    </figure>
  )
}
