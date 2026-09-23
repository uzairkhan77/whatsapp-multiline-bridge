'use client'

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] ' +
  'transition-all duration-200 ease-[var(--ease-out-soft)] disabled:cursor-not-allowed disabled:opacity-45 ' +
  'active:scale-[0.98] disabled:active:scale-100'

// 40px minimum touch target on the default size; `lg` is for the one button a
// screen is about (sign in), never for a row of actions.
const sizes = {
  md: 'min-h-10 px-3.5 py-2 text-sm font-medium',
  lg: 'min-h-15 px-5 py-3 text-lg font-bold',
} as const

// Primary is the site's orange — the one button someone clicks to act. Everything
// else stays in the blue/grey family so orange keeps its meaning.
const variants = {
  primary: 'bg-accent text-white shadow-[0_8px_20px_-10px_rgb(4_107_210/0.55)] hover:bg-accent-2',
  neutral: 'bg-surface/90 text-fg border border-line backdrop-blur hover:border-[#c5cfdb] hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger border border-danger/25 hover:bg-danger hover:text-white hover:border-danger',
  ghost: 'text-muted hover:text-fg hover:bg-fg/5',
} as const

export function Button({
  variant = 'neutral',
  size = 'md',
  className = '',
  busy = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  busy?: boolean
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {busy && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  )
}
