import 'server-only'

// types
import type { Instance, QrPayload, WebhookConfig } from '@/types/evolution'

// lib
import { env } from './env'
import { forget, remember } from './memo'

// Everything the gateway's own manager screen can do, it does through these
// same endpoints — no privileged channel. The key never leaves the server:
// the browser calls a Server Action, the action calls this.

class EvolutionError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message)
    this.name = 'EvolutionError'
  }
}

/**
 * One retry, for reads only, when the gateway could not be reached at all and
 * failed fast enough to be worth repeating. Node's client gives up past ten
 * seconds; a quick failure is usually a stumble, a slow one means the link
 * itself is slow. Never for a write — a timed-out request may already have
 * been carried out, and repeating it risks a second live number torn down.
 */
const RETRY_IF_FAILED_WITHIN_MS = 4_000

function isRead(init: RequestInit): boolean {
  return !init.method || init.method.toUpperCase() === 'GET'
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const started = Date.now()
  try {
    return await attempt<T>(path, init)
  } catch (error) {
    const unreachable = error instanceof Error && error.message.startsWith('Cannot reach the WhatsApp connection service')
    const elapsed = Date.now() - started
    if (!unreachable || !isRead(init) || elapsed > RETRY_IF_FAILED_WITHIN_MS) throw error
    console.warn(`[panel] gateway unreachable on ${path} after ${elapsed}ms, retrying once`)
    return attempt<T>(path, init)
  }
}

async function attempt<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${env.evolution.baseUrl}${path}`, {
      ...init,
      headers: { apikey: env.evolution.apiKey, 'content-type': 'application/json', ...init.headers },
      // Line state is the entire point of this screen; a cached "open" for a number
      // that dropped a minute ago is worse than no dashboard at all.
      cache: 'no-store',
      // A gateway that stops answering must fail the read, not hold the page
      // open indefinitely — the dashboard shows "unreachable" for that.
      signal: init.signal ?? AbortSignal.timeout(12_000),
    })
  } catch (cause) {
    // The address is on the cause, for the log; the message may reach a screen.
    throw new Error('Cannot reach the WhatsApp connection service', { cause })
  }

  const text = await response.text()
  if (!response.ok) {
    throw new EvolutionError(response.status, text, `The WhatsApp connection service returned ${response.status}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

const INSTANCES_KEY = 'gateway:instances'

/**
 * Every instance the gateway knows. Measured at 1.5-7 seconds per call, asked
 * for by every Lines render including the 15-second auto-refresh, so a reading
 * under 20 seconds old returns at once while the next is fetched behind it.
 * Every line-changing action calls forgetInstances() first.
 */
export async function fetchInstances(): Promise<{ instances: Instance[]; stale: boolean }> {
  const { value, stale } = await remember(INSTANCES_KEY, readInstances, {
    ttlMs: 2_000,
    swrMs: 20_000,
    // On a failed read, the last list stands for ten minutes and the page says
    // it is not live — an empty list instead would draw connected lines as
    // "Missing from gateway" on a wifi blip.
    staleMs: 10 * 60_000,
  })
  return { instances: value, stale }
}

/** Drops every gateway reading — the instance list and every line's webhook. */
export function forgetInstances(): void {
  forget('gateway:')
}

async function readInstances(): Promise<Instance[]> {
  const raw = await request<unknown>('/instance/fetchInstances')
  return Array.isArray(raw) ? (raw as Instance[]) : []
}

/**
 * Where the gateway is told to deliver this line's events. Worth surfacing:
 * the bridge registers this at boot for every routed line, so an empty or
 * stale webhook means a line quietly delivering to nobody.
 */
export async function findWebhook(instance: string): Promise<WebhookConfig | null> {
  try {
    // Same treatment as the instance list: a gateway round trip on every
    // detail-page render, and the answer changes only at boot.
    const { value } = await remember(
      `gateway:webhook:${instance}`,
      async () => {
        const raw = await request<{ url?: string; enabled?: boolean; events?: string[] } | null>(
          `/webhook/find/${encodeURIComponent(instance)}`,
        )
        if (!raw?.url) return null
        return { url: raw.url, enabled: raw.enabled ?? false, events: raw.events ?? [] }
      },
      { ttlMs: 2_000, swrMs: 60_000, staleMs: 0 },
    )
    return value
  } catch {
    return null
  }
}

export async function connectionState(instance: string): Promise<string> {
  const raw = await request<{ instance?: { state?: string } }>(
    `/instance/connectionState/${encodeURIComponent(instance)}`,
  )
  return raw?.instance?.state ?? 'unknown'
}

/** Returns a fresh QR. Evolution rotates it roughly every 30s, so this is polled. */
export async function connect(instance: string): Promise<QrPayload> {
  const raw = await request<{ base64?: string; code?: string; pairingCode?: string }>(
    `/instance/connect/${encodeURIComponent(instance)}`,
  )
  return {
    base64: raw?.base64 ?? null,
    code: raw?.code ?? null,
    pairingCode: raw?.pairingCode ?? null,
  }
}

export async function createInstance(instance: string): Promise<void> {
  // WHATSAPP-BAILEYS is the only channel this system supports. The gateway's
  // other option, "EVOLUTION", is not WhatsApp and never yields a QR.
  await request('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName: instance,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
    }),
  })
}

export async function logout(instance: string): Promise<void> {
  await request(`/instance/logout/${encodeURIComponent(instance)}`, { method: 'DELETE' })
}

export async function deleteInstance(instance: string): Promise<void> {
  await request(`/instance/delete/${encodeURIComponent(instance)}`, { method: 'DELETE' })
}

/**
 * Wait until the gateway stops listing a line it was just told to delete. The
 * gateway answers before it finishes: it removes the line in the background,
 * and a page reloaded in that gap would show it as freshly logged out. Returns
 * false if still listed when time runs out; the caller carries on either way.
 */
export async function waitUntilGone(instance: string, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // Forgotten first, or the remembered list would keep showing the line for
    // up to twenty seconds after the gateway dropped it.
    forgetInstances()
    const listed = await fetchInstances()
      .then(({ instances }) => instances.some((entry) => entry.name === instance))
      .catch(() => true)
    if (!listed) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

/**
 * Why a line dropped, in words an operator can act on. Baileys reports these
 * as raw numbers; 401 means the device was unlinked and the session is gone
 * for good, not "auth error, retry".
 */
export function disconnectReason(code: number | null): string | null {
  if (code === null) return null
  const known: Record<number, string> = {
    401: 'Logged out from the phone — needs a new QR scan',
    403: 'Blocked by WhatsApp',
    405: 'Not authorised — the session was replaced',
    408: 'Connection timed out',
    411: 'Multi-device mismatch',
    428: 'Connection closed by WhatsApp',
    440: 'Session replaced by another device',
    500: 'Bad session file',
    515: 'Restart required',
  }
  return known[code] ?? `Disconnected (code ${code})`
}
