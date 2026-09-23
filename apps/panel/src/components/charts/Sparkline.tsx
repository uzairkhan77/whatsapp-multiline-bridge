'use client'

// framework
import { useId } from 'react'
import { Area, AreaChart, YAxis } from 'recharts'

/**
 * Small trend line for a stat tile: last N readings as a smooth stroke with a
 * faded area beneath. No interaction — this only shows the shape, not values.
 */
// Colour arrives as a CSS value and is set as the wrapper's `color`; the SVG strokes
// with `currentColor` rather than putting the token into SVG attributes directly.
export function Sparkline({
  data,
  color = 'var(--color-chart-1)',
  className = '',
}: {
  data: number[]
  color?: string
  className?: string
}) {
  // useId returns characters like ":" or "«" that break `url(#…)` in some browsers.
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  if (data.length < 2) return null

  const min = Math.min(...data)
  const span = Math.max(1, Math.max(1, ...data) - min)
  const points = data.map((value, index) => ({ index, value }))

  return (
    <div className={className} style={{ color }} aria-hidden="true">
      <AreaChart
        responsive
        data={points}
        margin={{ top: 3, right: 2, bottom: 0, left: 2 }}
        style={{ width: '100%', height: '100%' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* A tenth of headroom under the lowest reading, so the stroke at a trough
            isn't sliced by the bottom edge while the fill still reaches it. */}
        <YAxis hide domain={[min - span * 0.1, min + span]} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="currentColor"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={false}
          animationDuration={1100}
        />
      </AreaChart>
    </div>
  )
}
