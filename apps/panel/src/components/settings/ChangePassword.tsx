'use client'

// framework
import { useState } from 'react'

// lib
import { changePassword } from '@/app/actions'

// components
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons'
import { PasswordInput } from '@/components/ui/PasswordInput'

export function ChangePassword({ email }: { email: string }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setError(null)
    setDone(false)
    if (next !== confirm) {
      setError('The two copies of the new password do not match.')
      return
    }
    setBusy(true)
    const result = await changePassword(current, next)
    setBusy(false)
    if (result.ok) {
      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
    } else {
      setError(result.error ?? 'Could not change the password')
    }
  }

  return (
    <form
      className="card flex flex-col gap-4 p-5 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex items-start gap-3">
        <span className="icon-tile bg-accent-soft text-accent">
          <Icon.Shield className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Password</h2>
          <p className="mt-0.5 text-sm text-muted">
            Signed in as <span className="text-fg break-all">{email}</span>. Forgotten it? Sign out
            and use <span className="text-fg">Forgot password</span> on the sign-in screen to get a
            link by email.
          </p>
        </div>
      </div>

      {/* Present but visually hidden: password managers use it to know which
          account this change belongs to. */}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />

      {/* htmlFor, not wrapping <label>s — see the caution in PasswordInput. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="current-password" className="text-sm font-medium">
          Current password
        </label>
        <PasswordInput
          id="current-password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className="text-sm font-medium">
            New password
          </label>
          <PasswordInput
            id="new-password"
            autoComplete="new-password"
            required
            minLength={8}
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          <span className="text-xs text-muted">At least 8 characters.</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-password" className="text-sm font-medium">
            New password, again
          </label>
          <PasswordInput
            id="confirm-password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="callout callout-danger">
          <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {done && (
        <p role="status" className="callout callout-good">
          <Icon.Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Password changed. It applies from your next sign-in; this session stays signed in.
          </span>
        </p>
      )}

      <div className="flex justify-end border-t border-line pt-4">
        <Button type="submit" variant="primary" busy={busy} disabled={!current || !next || !confirm}>
          Change password
        </Button>
      </div>
    </form>
  )
}
