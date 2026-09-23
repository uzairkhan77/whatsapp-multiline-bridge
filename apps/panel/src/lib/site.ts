import 'server-only'

// framework
import { headers } from 'next/headers'

/**
 * The panel's own public address, for the link Supabase puts in a
 * password-reset email. `PANEL_PUBLIC_URL` wins when set; otherwise the
 * request's own host. A forged Host header cannot redirect a reset link
 * elsewhere: Supabase only follows its own allow-listed URLs.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.PANEL_PUBLIC_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const head = await headers()
  const host = head.get('x-forwarded-host') ?? head.get('host') ?? 'localhost:3000'
  const protocol =
    head.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${protocol}://${host}`
}

/**
 * A redirect target guaranteed to stay on this site. The sign-in form and the
 * reset link carry it in a query string an attacker can write, so a leading
 * slash alone is not enough — `//evil.example` is also a valid browser target.
 */
export function safePath(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}
