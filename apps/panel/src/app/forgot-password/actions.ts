'use server'

// types
import type { ForgotState } from '@/types/actions'

// lib
import { emailAllowed } from '@/lib/allowlist'
import { supabase } from '@/lib/auth'
import { siteOrigin } from '@/lib/site'

export type { ForgotState } from '@/types/actions'

/**
 * Step one of a password reset: ask Supabase to email a recovery link. The
 * reply is deliberately identical whether or not the address has an account.
 */
export async function requestPasswordReset(
  _previous: ForgotState,
  form: FormData,
): Promise<ForgotState> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase()

  if (!email) return { error: 'Enter your email address.', email }

  // Checked before Supabase is asked, as signIn() does. Anyone not on
  // PANEL_ALLOWED_EMAILS could not sign in with a new password anyway, so they
  // get the same answer as everyone else.
  if (!emailAllowed(email)) return { sent: true, email }

  const client = await supabase()
  const origin = await siteOrigin()

  const { error } = await client.auth.resetPasswordForEmail(email, {
    // Supabase appends the token to this, and refuses any address that is not on
    // its redirect allow-list — see docs/02-deployment.md.
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  })

  if (error) {
    // Supabase already answers "unknown address" with success, so anything that
    // arrives here is a fault on our side — a send limit, or SMTP never configured.
    const tooMany = error.status === 429
    return {
      email,
      error: tooMany
        ? 'Too many reset emails have been requested for this address. Wait a few minutes and try again.'
        : `The reset email could not be sent (${error.message}). Ask an administrator to check the panel's email settings.`,
    }
  }

  return { sent: true, email }
}
