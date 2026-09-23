import 'server-only'

// Read on access, not at import. Next evaluates every server module during a
// build, and a build machine has no reason to hold production credentials.
function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `The panel reads the .env at the repository root; copy .env.example and fill it in.`,
    )
  }
  return value
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback
}

export const env = {
  evolution: {
    get baseUrl() {
      return optional('EVOLUTION_BASE_URL', 'http://localhost:8080').replace(/\/+$/, '')
    },
    get apiKey() {
      return required('EVOLUTION_API_KEY')
    },
  },
  // No chatwoot block. Those settings moved into bridge.chatwoot_settings on
  // 2026-09-02, read through lib/settings.ts and editable on the Settings screen.
  // CHATWOOT_* variables remain only as lib/settings.ts's transitional fallback.
  /**
   * Where the bridge receives webhooks, e.g. https://bridge.<ip>.sslip.io.
   * Display-only, for the Settings screen. Empty shows a placeholder instead.
   */
  get bridgePublicUrl() {
    return optional('BRIDGE_PUBLIC_URL', '').replace(/\/+$/, '')
  },
  get bridgeDatabaseUrl() {
    return required('BRIDGE_DATABASE_URL')
  },
  supabase: {
    // Auth only. The panel reads its data over BRIDGE_DATABASE_URL with pg —
    // this is the same Supabase project reached through its HTTP API instead,
    // the only way to verify a password and issue a session.
    get url() {
      return required('SUPABASE_URL').replace(/\/+$/, '')
    },
    // Publishable by design — grants nothing on its own — but kept server-side
    // anyway; see lib/auth.ts for why.
    get anonKey() {
      return required('SUPABASE_ANON_KEY')
    },
  },
  // PANEL_ALLOWED_EMAILS is not read here — see lib/allowlist.ts, which the
  // proxy must not import this module to reach the same answer.
  // No line configuration here either — see lib/lines.ts.
}
