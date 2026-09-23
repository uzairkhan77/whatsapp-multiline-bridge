// framework
import type { Metadata } from 'next'

// components
import { AuthCard } from '@/components/auth/AuthCard'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { Icon } from '@/components/ui/icons'

export const metadata: Metadata = { title: 'Reset password' }

// Same rule as the login screen: never cached, never prerendered. It reads the
// query string, and a cached copy of a signed-out screen is how someone ends up
// looking at a page that was rendered for somebody else.
export const dynamic = 'force-dynamic'

/** What the confirm route says when a link does not work. */
const LINK_PROBLEM = {
  expired: 'That reset link has already been used, or it has expired. Ask for a new one below.',
  denied: 'That link cannot be used to sign in to this panel. Ask an administrator for access.',
} as const

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; link?: string }>
}) {
  const { email, link } = await searchParams
  const problem = link === 'expired' || link === 'denied' ? LINK_PROBLEM[link] : null

  return (
    <AuthCard
      title="Reset your password"
      description="We'll email you a link that lets you choose a new one."
    >
      {problem && (
        <p role="alert" className="callout callout-warn mb-5">
          <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{problem}</span>
        </p>
      )}
      <ForgotPasswordForm initialEmail={email ?? ''} />
    </AuthCard>
  )
}
