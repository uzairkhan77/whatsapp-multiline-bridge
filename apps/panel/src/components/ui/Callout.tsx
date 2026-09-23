// components
import { Icon } from './icons'

type CalloutTone = 'warn' | 'danger'

interface CalloutProps {
  tone?: CalloutTone
  /** Animation slot for the page's staggered reveal. */
  index?: number
  children: React.ReactNode
}

/** A full-width notice above a page's content: amber for "some of this could not be read", red for "act now". */
export function Callout({ tone = 'warn', index = 1, children }: CalloutProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={`callout callout-${tone} reveal mb-gutter`}
      style={{ ['--i' as string]: index }}
    >
      <Icon.Warning className="mt-0.5 h-4.5 w-4.5 shrink-0" />
      <p>{children}</p>
    </div>
  )
}
