// Runtime configuration, read from the environment once at start-up.
//
// Lines live in bridge.lines (LineStore) and Chatwoot settings in
// bridge.chatwoot_settings (SingleRowStore). chatwootEnvSeed() only migrates the
// old CHATWOOT_* variables into that table on first boot.

import type { ChatwootSettings } from '../storage/chatwoot-settings.js'

/** A variable that must be set. `hint` says what it is for, in the error a person reads. */
export function requiredEnv(name: string, hint?: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}${hint ? ` — ${hint}` : ''}. ` +
        'Copy .env.example to .env at the repository root and fill it in.',
    )
  }
  return value
}

const required = requiredEnv

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback
}

function optionalNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim())
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export interface ResendConfig {
  /** Empty disables alert email; the bridge still runs. */
  apiKey: string
  /** Must be on a domain verified in Resend. The default only delivers to the Resend account's own address. */
  fromEmail: string
}

export interface Config {
  port: number
  /** Where Evolution posts webhooks. Must be reachable from the gateway. */
  publicUrl: string
  databaseUrl: string
  resend: ResendConfig
  evolution: {
    baseUrl: string
    apiKey: string
    /** Sent back on every webhook. Required, so the inbound endpoint is never open. */
    webhookSecret: string
  }
  /** Applied when a number arrives without a country code. WhatsApp JIDs always carry one. */
  defaultCountryCode: string
  /**
   * Largest inbound file carried into Chatwoot, in bytes. A memory ceiling:
   * Evolution hands a file over as base64 inside JSON, so one file in flight
   * costs several times its size. Chatwoot itself accepted 100MB uploads when
   * measured on 2026-09-11. Files over the limit become a note to the agent.
   */
  maxInboundMediaBytes: number
  /** A line down longer than this is emailed about; shorter drops are reconnect flaps. */
  lineDisconnectAlertSeconds: number
}

export function loadConfig(): Config {
  const port = optionalNumber('BRIDGE_PORT', 3001)
  return {
    port,
    publicUrl: optional('BRIDGE_PUBLIC_URL', `http://localhost:${port}`),
    databaseUrl: required('BRIDGE_DATABASE_URL'),
    resend: {
      apiKey: optional('RESEND_API_KEY', ''),
      fromEmail: optional('ALERT_FROM_EMAIL', 'onboarding@resend.dev'),
    },
    evolution: {
      baseUrl: optional('EVOLUTION_BASE_URL', 'http://localhost:8080').replace(/\/+$/, ''),
      apiKey: required('EVOLUTION_API_KEY'),
      webhookSecret: required('EVOLUTION_WEBHOOK_SECRET'),
    },
    defaultCountryCode: optional('DEFAULT_COUNTRY_CODE', ''),
    maxInboundMediaBytes: optionalNumber('MAX_INBOUND_MEDIA_MB', 64) * 1024 * 1024,
    lineDisconnectAlertSeconds: optionalNumber('LINE_DISCONNECT_ALERT_SECONDS', 120),
  }
}

/**
 * The CHATWOOT_* environment variables, when all three are present, for a
 * one-time migration into bridge.chatwoot_settings. Nothing reads them at
 * runtime; a bridge without them is configured in the database, not broken.
 */
export function chatwootEnvSeed(): ChatwootSettings | null {
  const accountId = optional('CHATWOOT_ACCOUNT_ID', '')
  const apiToken = optional('CHATWOOT_API_TOKEN', '')
  const webhookSecret = optional('CHATWOOT_WEBHOOK_SECRET', '')
  if (!accountId || !apiToken || !webhookSecret) return null

  return {
    baseUrl: optional('CHATWOOT_BASE_URL', 'https://app.chatwoot.com').replace(/\/+$/, ''),
    accountId,
    apiToken,
    webhookSecret,
  }
}
