'use client'

// framework
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

// lib
import { setNewPassword, type ResetState } from '@/app/reset-password/actions'

// components
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons'
import { PasswordInput } from '@/components/ui/PasswordInput'

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
      {pending ? 'Saving…' : 'Set new password'}
    </Button>
  )
}

export function ResetPasswordForm({ email }: { email: string }) {
  const [state, action] = useActionState<ResetState, FormData>(setNewPassword, {})

  return (
    <form action={action} className="flex flex-col gap-4 sm:gap-5">
      {/* Visually hidden, and there for password managers: it tells them which
          account the new password belongs to. */}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />

      {state.error && (
        <p role="alert" className="callout callout-danger">
          <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </p>
      )}

      {/* htmlFor, not wrapping <label>s — see the caution in PasswordInput. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-semibold sm:text-base">
          New password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          autoFocus
          placeholder="••••••••"
          className="min-h-12 text-base sm:min-h-13"
        />
        <span className="text-xs text-muted">At least 8 characters.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm" className="text-sm font-semibold sm:text-base">
          New password, again
        </label>
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          required
          placeholder="••••••••"
          className="min-h-12 text-base sm:min-h-13"
        />
      </div>

      <Submit />
    </form>
  )
}
