'use client'

// framework
import { useState, type InputHTMLAttributes } from 'react'

// components
import { Icon } from '@/components/ui/icons'

/**
 * Password field with a reveal-eye toggle. Used everywhere a secret-shaped input
 * appears so the toggle logic exists once.
 */
// Never wrap this in a <label>: clicking a label activates the button inside it,
// which would toggle the password instead of focusing the field. Use <label htmlFor> instead.
export function PasswordInput({
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [revealed, setRevealed] = useState(false)

  return (
    <div className="relative">
      <input
        {...props}
        type={revealed ? 'text' : 'password'}
        // Room on the right so a long value never runs under the button.
        className={`input pr-11 ${className}`}
      />
      <button
        type="button"
        // type="button" prevents this from submitting the form (buttons default to type="submit").
        onClick={() => setRevealed((shown) => !shown)}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        aria-pressed={revealed}
        // Not in the tab order. Tabbing should go field → field → submit without
        // stopping here; mouse, touch and screen readers still reach it.
        tabIndex={-1}
        className="hover:text-accent absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[var(--radius-control)] text-muted-2 transition-colors duration-150"
      >
        {revealed ? <Icon.EyeOff className="h-4.5 w-4.5" /> : <Icon.Eye className="h-4.5 w-4.5" />}
      </button>
    </div>
  )
}
