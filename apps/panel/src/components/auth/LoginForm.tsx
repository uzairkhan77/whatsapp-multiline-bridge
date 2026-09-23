'use client'

// framework
import Link from 'next/link'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

// lib
import { signIn, type LoginState } from '@/app/login/actions'

// components
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons'
import { PasswordInput } from '@/components/ui/PasswordInput'

// 16px on a phone, so iOS does not zoom the page when a field takes focus.
const field = 'input min-h-12 text-base sm:min-h-13'

/**
 * Its own component so the button can read useFormStatus, which only reports the
 * pending state of a form above it in the tree.
 */
function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primary" size="lg" busy={pending} className="mt-3 min-h-12 w-full text-base sm:mt-4 sm:min-h-13 sm:text-lg">
      {pending ? 'Signing in…' : 'Sign in'}
      {!pending && <Icon.ChevronRight className="h-5 w-5" />}
    </Button>
  )
}

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<LoginState, FormData>(signIn, {})

  return (
    <form action={action} className="flex flex-col gap-4 sm:gap-5">
      <input type="hidden" name="next" value={next} />

      {state.error && (
        <p role="alert" className="callout callout-danger">
          <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </p>
      )}

      <label className="reveal flex flex-col gap-1.5" style={{ ['--i' as string]: 2 }}>
        <span className="text-sm font-semibold sm:text-base">Email</span>
        <span className="relative">
          <Icon.Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4.5 w-4.5 -translate-y-1/2 text-muted-2" />
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            // Preserved across a failed attempt so only the password has to be retyped.
            defaultValue={state.email}
            placeholder="you@company.com"
            className={`${field} pl-11`}
          />
        </span>
      </label>

      <div className="reveal flex flex-col gap-1.5" style={{ ['--i' as string]: 3 }}>
        {/* htmlFor, not a wrapping <label> — see the caution in PasswordInput. */}
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="password" className="text-sm font-semibold sm:text-base">
            Password
          </label>
          {/* Beside the field it belongs to, which is where someone looks the
              moment they realise they do not know it. */}
          <Link
            href="/forgot-password"
            className="text-muted hover:text-accent text-[13px] font-semibold transition-colors duration-150"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="min-h-12 text-base sm:min-h-13"
        />
      </div>

      <div className="reveal" style={{ ['--i' as string]: 4 }}>
        <Submit />
      </div>
    </form>
  )
}
