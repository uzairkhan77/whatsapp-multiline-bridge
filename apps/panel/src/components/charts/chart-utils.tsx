'use client'

// lib
import { full } from '@/lib/format'

/**
 * Shared pieces for the Recharts charts: colours, axis styling, the tooltip card
 * and the legend under each chart.
 */

/**
 * Series and axis colours as literal values, mirroring the tokens in globals.css.
 * Recharts writes these into SVG attributes, and older Safari does not resolve
 * `var(--…)` there — a literal draws the same in every browser.
 */
export const CHART = {
  blue: '#046bd2', // --color-chart-1
  orange: '#f97316', // --color-chart-2
  lightBlue: '#93c0ee', // --color-chart-3
  grid: '#c7d3e3',
  axis: '#7d879a', // --color-muted-2
  day: '#4b5566', // --color-muted
  hover: 'rgba(4, 107, 210, 0.08)',
} as const

/**
 * One colour per agent, shared across every per-agent chart so the colour maps to
 * the same person everywhere. Ordered so neighbours sit apart on the hue wheel;
 * wraps after eight agents.
 */
export const AGENT_COLORS = [
  '#046bd2', // blue
  '#f97316', // orange
  '#0d9488', // teal
  '#7c3aed', // violet
  '#db2777', // pink
  '#16a34a', // green
  '#8b5e34', // brown — not amber, which sat too close to the orange two places up
  '#475569', // slate
] as const

export function agentColor(index: number): string {
  return AGENT_COLORS[index % AGENT_COLORS.length]!
}

export const valueTick = { fontSize: 10, fill: CHART.axis }
export const dayTick = { fontSize: 11, fill: CHART.day }

/** Rounded tops, nearly square bottoms — top-left, top-right, bottom-right, bottom-left. */
export const barRadius: [number, number, number, number] = [5, 5, 2, 2]

/** A quiet day keeps a hairline on the baseline, so the day still exists. */
export const quietDay = (value: number | null | undefined): number => (value && value > 0 ? 3 : 1.5)

/** Round a data maximum up to a 1 / 2 / 2.5 / 5 × 10ⁿ ceiling, so gridlines land on tidy numbers. */
export function niceMax(max: number): number {
  if (max <= 0) return 1
  const exponent = 10 ** Math.floor(Math.log10(max))
  const fraction = max / exponent
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * exponent
}

/**
 * Five evenly spaced ticks from zero to the top, deduplicated — a small maximum
 * can otherwise collapse two ticks onto the same value, which Recharts keys by value.
 */
export function ticksFor(max: number): number[] {
  return [...new Set([0, 0.25, 0.5, 0.75, 1].map((fraction) => max * fraction))]
}

export function tickLabel(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
  return Number.isInteger(value) ? full(value) : value.toFixed(1)
}

/**
 * First, middle, and last day — deduplicated, since Recharts keys ticks by value
 * and a short range can otherwise collapse two positions onto the same date.
 */
export function dayTicks(data: { day: string }[]): string[] {
  if (data.length === 0) return []
  return [
    ...new Set([data[0]!.day, data[Math.floor(data.length / 2)]!.day, data[data.length - 1]!.day]),
  ]
}

/**
 * Every day along the bottom, thinned past ~16 days to avoid overlapping labels;
 * the last day is always included.
 */
export function everyDay(data: { day: string }[], fit = 16): string[] {
  if (data.length === 0) return []
  const step = Math.max(1, Math.ceil(data.length / fit))
  const days = data.filter((_, index) => index % step === 0).map((point) => point.day)
  const last = data[data.length - 1]!.day
  return days.includes(last) ? days : [...days, last]
}

/** The floating readout over the hovered day. Recharts positions it; this is only its look. */
export function TooltipCard({
  title,
  rows,
}: {
  title: string
  rows: { label: string; value: string; color: string }[]
}) {
  return (
    <div className="glass-raised text-fg min-w-34 rounded-xl px-3 py-2 text-xs">
      <p className="mb-1 font-semibold">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-sm" style={{ background: row.color }} aria-hidden="true" />
          <span className="mr-auto">{row.label}</span>
          <span className="tnum text-fg font-medium">{row.value}</span>
        </p>
      ))}
    </div>
  )
}

export function Legend({
  items,
  note,
}: {
  items: { label: string; value: string; color: string }[]
  note?: string
}) {
  return (
    <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line pt-3 text-xs text-muted">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: item.color }} aria-hidden="true" />
          {item.label} <span className="tnum text-fg font-medium">{item.value}</span>
        </span>
      ))}
      {note && <span className="basis-full sm:ml-auto sm:basis-auto">{note}</span>}
    </figcaption>
  )
}
