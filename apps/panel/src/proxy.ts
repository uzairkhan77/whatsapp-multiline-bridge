import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { emailAllowed } from '@/lib/allowlist'

/*
  Runs before every request. Two jobs, in this order:

    1. Keep the session alive. Supabase access tokens expire after an hour and are
       renewed with a refresh token that rotates on use. The renewed pair has to be
       written back to the browser, and this file is the only place in a Next app
       that runs on every request and is allowed to set cookies — a Server Component
       cannot. Without this the panel would sign everyone out roughly hourly.

    2. Send signed-out visitors to /login rather than showing them an error.

  Only the second is visible, and only the first is the reason this file exists.

  This is NOT the security boundary. It can be bypassed by anything that reaches a
  Server Action endpoint directly, so the check that actually protects the dangerous
  operations is requireUser() at the top of each action in app/actions.ts. This is
  the convenience layer over that.

  Named proxy.ts, not middleware.ts: Next 16 renamed the convention and warns on the
  old name. The rename is also what makes this correct rather than merely working —
  a proxy file always runs on the Node runtime, so process.env below is the real
  environment this app loaded from the repository-root .env in next.config.mjs. The
  old Edge middleware was handed values inlined at build time from the app's own
  .env files, which this repo deliberately does not have, so these two settings
  would have been undefined locally and defined on Vercel: working in production and
  failing only on the machine where it is being tested. Do not add
  `export const runtime` here — a proxy file is not allowed one, and the build fails.
*/

/** Paths that must stay reachable while signed out. */
const PUBLIC = ['/login', '/forgot-password', '/reset-password', '/auth/confirm']

/**
 * Of those, the ones that must keep working while signed *in* as well.
 *
 * Verifying a recovery link signs the visitor in — that is precisely how the reset
 * screen is allowed to set a password, since the session is the only proof it has.
 * Left in the general rule below, they would be bounced to the dashboard one step
 * before they could choose a new password, and the reset would be impossible to
 * complete for exactly the people who need it.
 *
 * Nothing behind these two paths acts on the session other than replacing the
 * password, and doing that signs every session out.
 */
const PUBLIC_WHEN_SIGNED_IN = ['/reset-password', '/auth/confirm']

/** A path matches an entry if it is that path or sits beneath it. */
function matches(list: readonly string[], path: string): boolean {
  return list.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/**
 * Read here rather than through lib/env.ts, which this file must not import — see
 * lib/allowlist.ts. Named explicitly so a missing value says which one is missing:
 * without this, an unset key surfaces as "Cannot read properties of undefined" on
 * every request, which reads like a crash rather than a setting nobody filled in.
 */
function setting(name: 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing ${name}. The Operator Console signs in against Supabase Auth; without it ` +
        `nobody can log in. Copy it from the Supabase dashboard (Project Settings → ` +
        `API) into the repository-root .env, and into the environment variables of ` +
        `whatever is hosting the panel. See docs/02-deployment.md.`,
    )
  }
  return value
}

export async function proxy(request: NextRequest) {
  // Carries the request through untouched unless Supabase hands us new cookies.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    setting('SUPABASE_URL').replace(/\/+$/, ''),
    setting('SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          // Written twice on purpose. The request copy is what any downstream
          // getUser() in this same render reads; the response copy is what the
          // browser keeps for the next request. Setting only the response leaves
          // this request working from the token that was just replaced.
          for (const { name, value } of list) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of list) response.cookies.set(name, value, options)
        },
      },
    },
  )

  // This call is what performs the refresh. Its result drives the redirect below,
  // but the call would be worth making even if nothing read it.
  //
  // getClaims, not getUser: the project signs its tokens with an asymmetric key
  // (ES256), so the token is verified here against the project's public key —
  // fetched once and cached in the process — instead of by a round trip to
  // Supabase on every single request. That round trip was measured at anything
  // from 300ms to 5 seconds from here, and it sat in front of every page and
  // every filter click. A forged or expired token still fails verification.
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims

  // A real Supabase user who is not on PANEL_ALLOWED_EMAILS counts as signed out
  // here, exactly as the pages treat them. Without this the two disagree: the proxy
  // would wave them through, the page would send them to /login, and the proxy
  // would send them back — a redirect loop that only appears once someone is
  // removed from the list, which is precisely when nobody is watching for it.
  const signedIn = claims && emailAllowed(claims.email) ? claims : null

  const path = request.nextUrl.pathname
  const isPublic = matches(PUBLIC, path)

  if (!signedIn && !isPublic) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    // Remember where they were headed so signing in lands there rather than always
    // on the dashboard — the difference between a bookmarked line opening and a
    // person having to find it again.
    login.searchParams.set('next', path + request.nextUrl.search)
    return NextResponse.redirect(login)
  }

  if (signedIn && isPublic && !matches(PUBLIC_WHEN_SIGNED_IN, path)) {
    const home = request.nextUrl.clone()
    home.pathname = '/'
    home.search = ''
    return NextResponse.redirect(home)
  }

  return response
}

export const config = {
  matcher: [
    /*
      Everything except Next's own assets and image files.

      It must not exclude the paths Server Actions post to, because those are
      ordinary page paths — skipping them would leave the session unrefreshed
      exactly when someone is trying to act.
    */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
