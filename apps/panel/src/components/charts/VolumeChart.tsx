'use client'

// framework
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'

// types
import type { DailyVolume } from '@/types/db'

// lib
import { full, shortDay } from '@/lib/format'

// components
import {
  CHART,
  Legend,
  TooltipCard,
  barRadius,
  dayTick,
  dayTicks,
  niceMax,
  quietDay,
  tickLabel,
  ticksFor,
  valueTick,
} from './chart-utils'

/**
 * Fourteen days of message volume as paired columns (received vs sent) that grow
 * up from the baseline on load. Shape matters more than exact counts.
 */
export function VolumeChart({ data }: { data: DailyVolume[] }) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        No message history yet. Volume appears here once messages start flowing.
      </p>
    )
  }

  const peak = niceMax(Math.max(...data.map((d) => Math.max(d.inbound, d.outbound))))
  const totalIn = data.reduce((sum, d) => sum + d.inbound, 0)
  const totalOut = data.reduce((sum, d) => sum + d.outbound, 0)
  const busiest = Math.max(...data.map((d) => d.inbound + d.outbound))

  return (
    <figure className="m-0">
      <div
        className="h-48 sm:h-60"
        role="img"
        aria-label={`Message volume over the last ${data.length} days: ${full(totalIn)} received, ${full(totalOut)} sent. The busiest day carried ${full(busiest)} messages.`}
      >
        <BarChart
          responsive
          data={data}
          margin={{ top: 6, right: 12, bottom: 0, left: 0 }}
          barGap={3}
          barCategoryGap="18%"
          style={{ width: '100%', height: '100%' }}
        >
          <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            ticks={dayTicks(data)}
            tickFormatter={shortDay}
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={dayTick}
            tickMargin={8}
          />
          <YAxis
            domain={[0, peak]}
            ticks={ticksFor(peak)}
            tickFormatter={tickLabel}
            width={32}
            axisLine={false}
            tickLine={false}
            tick={valueTick}
          />
          <Tooltip
            cursor={{ fill: CHART.hover }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const day = payload?.[0]?.payload as DailyVolume | undefined
              if (!active || !day) return null
              return (
                <TooltipCard
                  title={shortDay(day.day)}
                  rows={[
                    { label: 'Received', value: full(day.inbound), color: CHART.blue },
                    { label: 'Sent', value: full(day.outbound), color: CHART.lightBlue },
                  ]}
                />
              )
            }}
          />
          <Bar
            dataKey="inbound"
            name="Received"
            fill={CHART.blue}
            radius={barRadius}
            maxBarSize={20}
            minPointSize={quietDay}
            animationDuration={700}
          />
          <Bar
            dataKey="outbound"
            name="Sent"
            fill={CHART.lightBlue}
            radius={barRadius}
            maxBarSize={20}
            minPointSize={quietDay}
            animationDuration={700}
          />
        </BarChart>
      </div>

      <Legend
        items={[
          { label: 'Received', value: full(totalIn), color: CHART.blue },
          { label: 'Sent', value: full(totalOut), color: CHART.lightBlue },
        ]}
        note="Message counts only — no message text is stored"
      />
    </figure>
  )
}
