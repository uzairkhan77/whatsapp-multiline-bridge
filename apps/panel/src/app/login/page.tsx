// framework
import type { Metadata } from 'next'

// components
import { LoginForm } from '@/components/auth/LoginForm'
import { Icon } from '@/components/ui/icons'

export const metadata: Metadata = { title: 'Sign in' }

// Nothing on this page may be cached or prerendered: it reads the redirect target
// from the query string, and a cached login screen is how someone ends up signed
// into a page they did not open.
export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>
}) {
  const { next, reset } = await searchParams

  return (
    <div className="flex min-h-dvh items-center justify-center py-8 sm:px-8 sm:py-10">
      <main id="main" className="w-full max-w-[34rem]">
        <div className="reveal mb-6 px-4 text-center sm:px-0" style={{ ['--i' as string]: 0 }}>
          <span className="bg-accent-gradient float mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-[var(--shadow-accent)] sm:h-16 sm:w-16">
            S
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-4xl">
            Welcome to <span className="text-gradient">Operator Console</span>
          </h1>
          <p className="mt-2 text-base font-medium text-muted sm:text-lg">
            Every conversation, every line, every sale — in one place.
          </p>
        </div>

        {/* Edge to edge on a phone — a card with a gutter either side wastes the one
            dimension a phone is short of — and a card again from the sm breakpoint. */}
        <div className="card card-solid reveal overflow-hidden max-sm:rounded-none max-sm:border-x-0" style={{ ['--i' as string]: 1 }}>
          <div className="p-5 sm:p-9">
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Sign in</h2>
            <p className="mt-1.5 mb-6 text-sm font-medium text-muted sm:mb-7 sm:text-base">Use the account your administrator created for you.</p>
            {/* Set by the reset screen once a new password is saved. Every session
                was signed out at that moment, so arriving here is expected, not a
                failure — say so, or it reads as having been kicked out. */}
            {reset === '1' && (
              <p role="status" className="callout callout-good mb-5">
                <Icon.Check className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Password changed. Sign in with the new one.</span>
              </p>
            )}
            <LoginForm next={next ?? '/'} />
          </div>
        </div>

        {/* Accounts are created in Supabase by an administrator, never from this
            screen — a public sign-up form could disconnect a live WhatsApp number.
            A forgotten password is self-service via the reset link above. */}
        <p className="reveal mt-5 px-4 text-center text-[13px] font-medium text-muted sm:px-0 sm:text-sm" style={{ ['--i' as string]: 3 }}>
          Accounts are created by an administrator. Ask them if you need access.
        </p>
      </main>
    </div>
  )
}
