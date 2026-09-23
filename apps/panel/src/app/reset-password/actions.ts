'use server'

// framework
import { redirect } from 'next/navigation'

// types
import type { ResetState } from '@/types/actions'

// lib
import { currentUser, supabase } from '@/lib/auth'

export type { ResetState } from '@/types/actions'

/**
 * Step two: set the new password. The proof this is allowed is the session the
 * recovery link created — nothing here trusts a value the browser sent.
 */
export async function setNewPassword(_previous: ResetState, form: FormData): Promise<ResetState> {
  const password = String(form.get('password') ?? '')
  const confirm = String(form.get('confirm') ?? '')

  const user = await currentUser()
  if (!user) {
    return {
      error: 'This reset link has expired. Ask for a new one and use it within the hour.',
    }
  }

  if (password.length < 8) return { error: 'The new password needs at least 8 characters.' }
  if (password !== confirm) return { error: 'The two copies of the new password do not match.' }

  const client = await supabase()
  const { error } = await client.auth.updateUser({ password })
  if (error) {
    // Supabase phrases some refusals better than a generic message would — "should
    // be different from the old password", for one. Those go straight through.
    return { error: error.message }
  }

  // Every session signed in with the old password is signed out, on every
  // device — a reset implies the old password may be known to someone else,
  // so their session should not survive it.
  await client.auth.signOut({ scope: 'global' })

  redirect('/login?reset=1')
}
