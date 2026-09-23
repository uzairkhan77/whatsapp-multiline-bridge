'use client'

// framework
import Link from 'next/link'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

// lib
import { requestPasswordReset, type ForgotState } from '@/app/forgot-password/actions'

// components
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons'

const field = 'input min-h-12 text-base sm:min-h-13'

function Submit() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="primary"
      size="lg"
      busy={pending}
      className="mt-3 min-h-12 w-full text-base sm:mt-4 sm:min-h-13 sm:text-lg"
    >
      {pending ? 'Sending…' : 'Email me a reset link'}
      {!pending && <Icon.ChevronRight className="h-5 w-5" />}
    </Button>
  )
}

export function ForgotPasswordForm({ initialEmail = '' }: { initialEmail?: string }) {
  const [state, action] = useActionState<ForgotState, FormData>(requestPasswordReset, {})

  // Shown whether or not the address has an account here — see the action for why.
  if (state.sent) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="callout callout-good">
          <Icon.Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            If <span className="font-semibold break-all">{state.email}</span> has an account here,
            a reset link is on its way. It works once, and only for the next hour.
          </span>
        </p>
        <p className="text-sm text-muted">
          Nothing after a few minutes? Check the spam folder, then ask an administrator — the
          panel can only email addresses it has been told to allow.
        </p>
        <Link href="/login" className="text-accent inline-flex items-center gap-1 text-sm font-semibold">
          <Icon.ChevronLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-4 sm:gap-5">
      {state.error && (
        <p role="alert" className="callout callout-danger">
          <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </p>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold sm:text-base">Email</span>
        <span className="relative">
          <Icon.Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4.5 w-4.5 -translate-y-1/2 text-muted-2" />
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            autoFocus
            defaultValue={state.email ?? initialEmail}
            placeholder="you@company.com"
            className={`${field} pl-11`}
          />
        </span>
      </label>

      <Submit />

      <Link
        href="/login"
        className="text-muted hover:text-accent inline-flex items-center justify-center gap-1 text-sm font-semibold transition-colors duration-150"
      >
        <Icon.ChevronLeft className="h-4 w-4" />
        Back to sign in
      </Link>
    </form>
  )
}
