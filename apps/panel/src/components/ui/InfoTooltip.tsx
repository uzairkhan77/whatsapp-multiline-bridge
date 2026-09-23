// components
import { Icon } from './icons'

/**
 * Pure-CSS hover/focus tooltip; no client JS needed, so it stays a server component.
 * Used on the Funnel's response-time and Online-time charts, where the figure needs
 * a sentence about where it came from.
 */
export function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group/tip relative inline-flex" tabIndex={0}>
      <Icon.Info className="hover:text-accent h-3.5 w-3.5 text-muted-2 transition-colors duration-150" />
      <span
        role="tooltip"
        className="tip pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 translate-y-1 rounded-xl p-3 text-left text-xs leading-relaxed font-normal normal-case tracking-normal opacity-0 transition-all duration-200 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-focus/tip:translate-y-0 group-focus/tip:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}
