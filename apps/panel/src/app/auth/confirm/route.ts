import { NextResponse, type NextRequest } from 'next/server'
import { supabase } from '@/lib/auth'
import { emailAllowed } from '@/lib/allowlist'
import { safePath } from '@/lib/site'

/*
  Where a password-reset email lands.

  This is the one place in the panel that turns something arriving from outside
  into a signed-in session, so every check it makes is load-bearing.

  A Route Handler rather than a page because it must write cookies — a Server
  Component may not, and a session that cannot be written is no session at all.

  Two shapes of link are accepted, because Supabase can send either:

    ?token_hash=…&type=recovery   the token itself, verified here. Works from any
                                  browser on any device, which matters: people
                                  read email on a phone and were sitting at a
                                  desktop when they asked.

    ?code=…                       Supabase's PKCE exchange. The matching verifier
                                  is a cookie set when the reset was requested, so
                                  this one only works in the same browser that
                                  asked. Accepted as a fallback so the flow still
                                  works before the email template is switched to
                                  the token_hash form (docs/02-deployment.md).

  Anything else is treated as a dead link, not as an error to explain: a visitor
  here has either a valid link or no business having one.
*/

/** Where a link that does not work sends people — one place, used for every refusal. */
function deadLink(request: NextRequest, reason: 'expired' | 'denied'): NextResponse {
  const url = request.nextUrl.clone()
  url.pathname = '/forgot-password'
  url.search = `?link=${reason}`
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams
  const tokenHash = params.get('token_hash')
  const code = params.get('code')
  const type = params.get('type')

  // Recovery only. Supabase uses this same URL shape for signup confirmations,
  // email changes and invites; this panel creates accounts by hand in the Supabase
  // dashboard, so none of those should ever be honoured here. Accepting them would
  // quietly reopen the self-service sign-up that is switched off on purpose.
  if (tokenHash && type !== 'recovery') return deadLink(request, 'denied')

  const client = await supabase()

  if (tokenHash) {
    const { error } = await client.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
    if (error) return deadLink(request, 'expired')
  } else if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code)
    if (error) return deadLink(request, 'expired')
  } else {
    return deadLink(request, 'expired')
  }

  // The session exists now. It still has to belong to someone this panel admits:
  // a real Supabase user who is not on PANEL_ALLOWED_EMAILS must not be handed a
  // session here, or the proxy and the pages would spend the rest of the visit
  // disagreeing about whether they are signed in.
  const { data } = await client.auth.getClaims()
  if (!emailAllowed(data?.claims?.email)) {
    await client.auth.signOut()
    return deadLink(request, 'denied')
  }

  const url = request.nextUrl.clone()
  // Only ever a path on this site: `next` travels through the email and back, so
  // it is as writable by a stranger as any other query string.
  url.pathname = safePath(params.get('next'), '/reset-password')
  url.search = ''
  return NextResponse.redirect(url)
}
