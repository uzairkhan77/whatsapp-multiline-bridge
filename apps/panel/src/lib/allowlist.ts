/**
 * PANEL_ALLOWED_EMAILS — the optional second gate on who may use this panel.
 * Empty list allows any confirmed Supabase user; safe only while sign-ups are
 * disabled in the Supabase dashboard. See docs/02-deployment.md.
 * No imports on purpose: the proxy and the Server Components both call this
 * and must always agree, or a rejected user bounces between them forever.
 */
export function emailAllowed(email: string | null | undefined): boolean {
  const list = (process.env.PANEL_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  if (list.length === 0) return true
  return list.includes((email ?? '').toLowerCase())
}
