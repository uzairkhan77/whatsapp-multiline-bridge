'use server'

// framework
import { redirect } from 'next/navigation'

// types
import type { LoginState } from '@/types/actions'

// lib
import { emailAllowed } from '@/lib/allowlist'
import { supabase } from '@/lib/auth'

export type { LoginState } from '@/types/actions'

/**
 * Sign in with email and password. No sign-up or magic-link action — accounts
 * are created by an administrator; see docs/02-deployment.md.
 */
export async function signIn(_previous: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase()
  const password = String(form.get('password') ?? '')
  const next = String(form.get('next') ?? '/')

  if (!email || !password) {
    return { error: 'Enter your email address and password.', email }
  }

  // Checked before Supabase is asked, so an address that is not permitted here
  // cannot be used to probe which accounts exist in the project. Same wording as a
  // wrong password, for the same reason.
  if (!emailAllowed(email)) {
    return { error: 'Email address or password is not correct.', email }
  }

  const client = await supabase()
  const { error } = await client.auth.signInWithPassword({ email, password })

  if (error) {
    // One message for every failure, on purpose. Supabase distinguishes "no such
    // user" from "wrong password", and repeating that distinction back would let
    // anyone with the URL work out who has an account here.
    return { error: 'Email address or password is not correct.', email }
  }

  // Only ever to a path on this site. `next` arrives in the query string, so
  // without this check a crafted link could bounce someone straight off to another
  // host immediately after they signed in.
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/')
}

export async function signOut(): Promise<void> {
  const client = await supabase()
  await client.auth.signOut()
  redirect('/login')
}
