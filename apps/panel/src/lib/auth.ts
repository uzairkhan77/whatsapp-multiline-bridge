import 'server-only'

// framework
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'

// types
import type { User } from '@/types/auth'

// lib
import { emailAllowed } from './allowlist'
import { env } from './env'

// Login for the Operator Console: Supabase Auth, email and password only. Everything
// runs server-side — no Supabase client in the browser, no NEXT_PUBLIC_ variable
// anywhere in this app (same rule next.config.mjs states for the gateway key).
// Sessions live in cookies Supabase sets and signs; there is no PANEL_SESSION_SECRET.

/**
 * A Supabase client bound to this request's cookies.
 *
 * `setAll` swallows write errors: Server Components cannot write cookies, and
 * the middleware already performs the same token refresh where it can write.
 */
export async function supabase(): Promise<SupabaseClient> {
  const store = await cookies()

  return createServerClient(env.supabase.url, env.supabase.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options)
        } catch {
          // Server Component render. The middleware already refreshed it.
        }
      },
    },
  })
}

/**
 * The signed-in user, or null. `getClaims`, never `getSession`: getSession
 * trusts the cookie, getClaims verifies its signature — necessary on a screen
 * where a forged cookie could disconnect a live number (see src/proxy.ts for
 * why not getUser). Wrapped in `cache()` so one request means one verification,
 * not two — the root layout and every page both call this.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const client = await supabase()
  const { data, error } = await client.auth.getClaims()
  const claims = data?.claims
  if (error || !claims) return null
  // Same check the proxy applies, from the same module — see lib/allowlist.ts.
  return emailAllowed(claims.email) ? { id: claims.sub, email: claims.email } : null
})

/**
 * The signed-in user, or a redirect to the login screen. Every Server Action
 * that changes something calls this first: Server Actions are ordinary POST
 * endpoints anyone can call directly, so this is the actual protection — the
 * middleware is only the convenience.
 */
export async function requireUser(): Promise<User> {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}
