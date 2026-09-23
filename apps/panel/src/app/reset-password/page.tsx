// framework
import type { Metadata } from 'next'
import Link from 'next/link'

// lib
import { currentUser } from '@/lib/auth'

// components
import { AuthCard } from '@/components/auth/AuthCard'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import { Icon } from '@/components/ui/icons'

export const metadata: Metadata = { title: 'New password' }

export const dynamic = 'force-dynamic'

/**
 * Choose a new password. Reached only through /auth/confirm, which turns the
 * emailed token into the session this page needs; the action re-checks it too.
 */
export default async function ResetPasswordPage() {
  const user = await currentUser()

  if (!user) {
    return (
      <AuthCard
        title="This link has expired"
        description="Reset links work once, and only for an hour."
      >
        <p className="callout callout-warn mb-5">
          <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Open the panel from a fresh link. If you already used this one to set a password,
            sign in with it instead.
          </span>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/forgot-password"
            className="bg-accent-gradient inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-accent)] transition-all duration-200 hover:brightness-110"
          >
            Email me a new link
          </Link>
          <Link
            href="/login"
            className="border-line text-fg hover:bg-fg/5 inline-flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-control)] border px-4 text-sm font-semibold transition-colors duration-150"
          >
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Signing you out everywhere else once it is set."
    >
      <p className="mb-5 text-sm font-medium text-muted">
        For <span className="text-fg break-all">{user.email}</span>.
      </p>
      <ResetPasswordForm email={user.email ?? ''} />
    </AuthCard>
  )
}
