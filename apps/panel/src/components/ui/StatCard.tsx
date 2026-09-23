// components
import { Sparkline } from '../charts/Sparkline'
import { CountUp } from './CountUp'

const tints = {
  accent: { tile: 'bg-accent-soft text-accent', glow: 'bg-accent', line: 'var(--color-chart-1)' },
  teal: { tile: 'bg-[#e4effb] text-[#2f7fd6]', glow: 'bg-chart-3', line: 'var(--color-accent)' },
  amber: { tile: 'bg-[#fff1e6] text-[#ea580c]', glow: 'bg-chart-2', line: 'var(--color-chart-2)' },
  good: { tile: 'bg-good-soft text-good', glow: 'bg-good', line: 'var(--color-good)' },
  danger: { tile: 'bg-danger-soft text-danger', glow: 'bg-danger', line: 'var(--color-danger)' },
  neutral: { tile: 'bg-surface-2 text-muted', glow: 'bg-muted', line: 'var(--color-muted)' },
} as const

export type StatTint = keyof typeof tints

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  tint = 'accent',
  icon,
  labelExtra,
  index = 0,
  spark,
}: {
  label: string
  value: string
  hint?: string | null
  tone?: 'default' | 'good' | 'bad'
  /** Colour of the icon tile — a hint about the metric's family, not its state. */
  tint?: StatTint
  icon?: React.ReactNode
  /** Small element beside the label — currently only the attribution-rule tooltip on Funnel. */
  labelExtra?: React.ReactNode
  /** Position in its row, for the entrance stagger. */
  index?: number
  /** Recent readings of this metric, oldest first, drawn as a sparkline. */
  spark?: number[]
}) {
  const valueTone = tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-danger' : 'text-fg'
  const look = tone === 'good' ? tints.good : tone === 'bad' ? tints.danger : tints[tint]

  return (
    <div className="card card-hover reveal relative p-4" style={{ ['--i' as string]: index }}>
      <div className="relative flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-muted" title={label}>
          <span className="truncate">{label}</span>
          {labelExtra}
        </p>
        {icon && <span className={`icon-tile h-8 w-8 rounded-lg ${look.tile}`}>{icon}</span>}
      </div>
      <div className="mt-2">
        <p className={`tnum text-[1.65rem] leading-none font-bold tracking-tight sm:text-[1.9rem] ${valueTone}`}>
          <CountUp value={value} />
        </p>
        {/* Reserved height, so a hint arriving after a refresh does not shift the row. */}
        <p className="mt-1.5 min-h-4 text-xs font-medium text-muted">{hint ?? ''}</p>
        {/* The sparkline gets its own strip under the figures, so it never runs into
            the number however wide the number gets. */}
        {spark && spark.length > 1 && (
          <div className="mt-2 h-7 w-full">
            <Sparkline data={spark} color={look.line} className="h-full w-full" />
          </div>
        )}
      </div>
    </div>
  )
}
