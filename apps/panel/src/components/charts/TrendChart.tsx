'use client'

// framework
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'

// types
import type { FunnelTrendPoint } from '@/types/funnel'

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

/** Conversations opened per day, as columns — shape over the period is the signal. */
export function TrendChart({ data }: { data: FunnelTrendPoint[] }) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No conversations in this period yet.</p>
  }

  const convMax = niceMax(Math.max(...data.map((d) => d.conversations)))
  const totalConversations = data.reduce((sum, d) => sum + d.conversations, 0)

  return (
    <figure className="m-0">
      <div
        className="h-48 sm:h-60"
        role="img"
        aria-label={`Conversations over ${data.length} days: ${full(totalConversations)} in total.`}
      >
        <BarChart
          responsive
          data={data}
          margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
          barGap={3}
          barCategoryGap="18%"
          style={{ width: '100%', height: '100%' }}
        >
          <CartesianGrid yAxisId="conversations" vertical={false} stroke={CHART.grid} strokeDasharray="3 3" />
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
            yAxisId="conversations"
            domain={[0, convMax]}
            ticks={ticksFor(convMax)}
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
              const day = payload?.[0]?.payload as FunnelTrendPoint | undefined
              if (!active || !day) return null
              return (
                <TooltipCard
                  title={shortDay(day.day)}
                  rows={[{ label: 'Conversations', value: full(day.conversations), color: CHART.blue }]}
                />
              )
            }}
          />
          <Bar
            yAxisId="conversations"
            dataKey="conversations"
            name="Conversations"
            fill={CHART.blue}
            radius={barRadius}
            maxBarSize={20}
            minPointSize={quietDay}
            animationDuration={700}
          />
        </BarChart>
      </div>

      <Legend
        items={[{ label: 'Conversations', value: full(totalConversations), color: CHART.blue }]}
        note="One column per day — shape over the period, not height, is the signal"
      />
    </figure>
  )
}
