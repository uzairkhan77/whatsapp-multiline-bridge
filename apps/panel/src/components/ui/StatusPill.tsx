// enums
import { LineHealth } from '@/enums/line-health'

// components
import { Icon } from './icons'

// Status uses an icon, a word, and a colour together, so it still reads for a
// colour-blind viewer, a greyscale screenshot, or a glance from across the room.
const look: Record<
  LineHealth,
  { label: string; tone: string; Glyph: (p: { className?: string }) => React.ReactElement }
> = {
  [LineHealth.Up]: {
    label: 'Connected',
    tone: 'text-good bg-good-soft ring-good/25',
    Glyph: Icon.Connected,
  },
  [LineHealth.Down]: {
    label: 'Disconnected',
    tone: 'text-danger bg-danger-soft ring-danger/25',
    Glyph: Icon.Disconnected,
  },
  // Labeled "Waiting for scan", not "Connecting": the gateway's `connecting` state persists
  // indefinitely until a person scans the QR, so a spinner would misrepresent it.
  [LineHealth.Connecting]: {
    label: 'Waiting for scan',
    tone: 'text-warn bg-warn-soft ring-warn/25',
    Glyph: Icon.Qr,
  },
  [LineHealth.Disabled]: {
    label: 'Out of service',
    tone: 'text-muted bg-surface-2 ring-line',
    Glyph: Icon.Paused,
  },
  [LineHealth.Unconfigured]: {
    // Describes the consequence (messages are being lost), not the storage detail
    // (missing from lines.json).
    label: 'Not routed',
    tone: 'text-warn bg-warn-soft ring-warn/25',
    Glyph: Icon.Warning,
  },
  [LineHealth.Missing]: {
    label: 'Not found',
    tone: 'text-warn bg-warn-soft ring-warn/25',
    Glyph: Icon.Warning,
  },
  // Grey, not amber: nothing is known to be wrong, and using an alarm colour here
  // would train people to ignore the colour when it does mean trouble.
  [LineHealth.Unknown]: {
    label: 'Status unknown',
    tone: 'text-muted bg-surface-2 ring-line',
    Glyph: Icon.Info,
  },
}

export function StatusPill({ health, className = '' }: { health: LineHealth; className?: string }) {
  const { label, tone, Glyph } = look[health]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${tone} ${className}`}
    >
      <span className="relative inline-flex">
        <Glyph className="h-3.5 w-3.5" />
        {health === LineHealth.Up && <span className="live-dot" />}
      </span>
      {label}
    </span>
  )
}
