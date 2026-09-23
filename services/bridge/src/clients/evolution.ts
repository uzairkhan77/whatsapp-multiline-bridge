// Evolution gateway client. Evolution is transport only and stores nothing, so the
// bridge carries everything it needs to know about a message itself.

// configuration and logging
import type { Config } from '../core/config.js'

// media
import type { EvolutionMediaType } from '../media/media.js'

export class EvolutionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'EvolutionError'
  }
}

export interface SendResult {
  /** Evolution's id for the sent message, used to tie the two sides together. */
  messageId: string | null
}

/** A file downloaded from WhatsApp, on its way to Chatwoot. */
export interface FetchedMedia {
  bytes: Buffer
  /** What Evolution says it is, which can differ from what the message claimed. */
  mimetype: string | null
  fileName: string | null
}

/** What to send, in the shape Evolution's /message/sendMedia asks for. */
export interface OutboundMediaRequest {
  mediatype: EvolutionMediaType
  /** A URL Evolution can fetch, or base64 bytes. Chatwoot attachment URLs are public, so we pass those. */
  media: string
  fileName: string
  caption?: string | null
}

export class EvolutionClient {
  private readonly base: string
  private readonly apiKey: string

  constructor(config: Config) {
    this.base = config.evolution.baseUrl
    this.apiKey = config.evolution.apiKey
  }

  /** `timeoutMs` overrides the 30s default for the few calls that move a file. */
  private async request<T>(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> {
    const { timeoutMs, ...rest } = init
    const response = await fetch(`${this.base}${path}`, {
      ...rest,
      headers: {
        apikey: this.apiKey,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs ?? 30_000),
    })

    const text = await response.text()
    if (!response.ok) {
      throw new EvolutionError(
        `Evolution ${init.method ?? 'GET'} ${path} failed with ${response.status}`,
        response.status,
        text.slice(0, 500),
      )
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  /** `open` means the line is connected. Anything else is not sendable. */
  async connectionState(instance: string): Promise<string> {
    const result = await this.request<{ instance?: { state?: string } }>(
      `/instance/connectionState/${encodeURIComponent(instance)}`,
    )
    return result.instance?.state ?? 'unknown'
  }

  /**
   * The WhatsApp number this line is signed in as (+digits), or null. Used by the
   * alert emails. Evolution has no per-instance endpoint for this, so it lists
   * every instance; never on the path of a message.
   */
  async ownerNumber(instance: string): Promise<string | null> {
    const raw = await this.request<unknown>('/instance/fetchInstances')
    if (!Array.isArray(raw)) return null
    const found = (raw as { name?: string; ownerJid?: string | null }[]).find(
      (row) => row.name === instance,
    )
    // The JID is <digits>@s.whatsapp.net. A logged-out instance may have none;
    // the caller treats that as "number unknown", not as a failure.
    const digits = found?.ownerJid?.split('@')[0]?.replace(/\D/g, '')
    return digits ? `+${digits}` : null
  }

  async sendText(instance: string, number: string, text: string): Promise<SendResult> {
    const result = await this.request<{ key?: { id?: string } }>(
      `/message/sendText/${encodeURIComponent(instance)}`,
      { method: 'POST', body: JSON.stringify({ number, text }) },
    )
    return { messageId: result.key?.id ?? null }
  }

  /**
   * Download the file on an inbound media message. `message` must be the webhook's
   * whole `data` object: given only a key, Evolution looks in its own database, where
   * nothing is stored. 90s timeout, inside the 120s WEBHOOK_REQUEST_TIMEOUT_MS in evolution.env.
   * Overrunning that is survivable: the file still reaches Chatwoot and the gateway's
   * redelivery is dropped as a duplicate by the claim in bridge.message_map.
   */
  async fetchMedia(instance: string, message: unknown): Promise<FetchedMedia> {
    const result = await this.request<{
      base64?: string
      mimetype?: string
      fileName?: string
    }>(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
      method: 'POST',
      body: JSON.stringify({ message }),
      timeoutMs: 90_000,
    })

    if (!result?.base64) {
      // Evolution answers 200 with an empty body when the message carries no media
      // after all (context metadata only). Nothing to forward.
      throw new EvolutionError('Evolution returned no media for the message', 200, '')
    }

    return {
      bytes: Buffer.from(result.base64, 'base64'),
      mimetype: result.mimetype ?? null,
      fileName: result.fileName ?? null,
    }
  }

  /**
   * Send a file to a customer. `media` is a URL Evolution fetches itself (Chatwoot
   * Cloud attachment URLs are public); a private Chatwoot would need base64 instead.
   * `fileName` is always sent: without one Evolution regex-parses the URL and throws.
   */
  async sendMedia(
    instance: string,
    number: string,
    media: OutboundMediaRequest,
  ): Promise<SendResult> {
    const result = await this.request<{ key?: { id?: string } }>(
      `/message/sendMedia/${encodeURIComponent(instance)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          number,
          mediatype: media.mediatype,
          fileName: media.fileName,
          media: media.media,
          // Only when present: an empty caption still shows as a blank line under
          // the picture.
          ...(media.caption ? { caption: media.caption } : {}),
        }),
        timeoutMs: 120_000,
      },
    )
    return { messageId: result.key?.id ?? null }
  }

  /**
   * Send audio as a voice note (plays inline; Evolution transcodes to the codec
   * WhatsApp plays). Takes no caption, so the caller sends any text separately.
   */
  async sendVoiceNote(instance: string, number: string, audio: string): Promise<SendResult> {
    const result = await this.request<{ key?: { id?: string } }>(
      `/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`,
      { method: 'POST', body: JSON.stringify({ number, audio }), timeoutMs: 120_000 },
    )
    return { messageId: result.key?.id ?? null }
  }

  /**
   * Revoke a message "for everyone" — the only kind WhatsApp allows deleting after the
   * fact, and only for a message this instance itself sent (`fromMe` must be true).
   */
  async deleteMessage(
    instance: string,
    args: { id: string; remoteJid: string; fromMe: boolean; participant?: string },
  ): Promise<void> {
    await this.request(`/chat/deleteMessageForEveryone/${encodeURIComponent(instance)}`, {
      method: 'DELETE',
      body: JSON.stringify(args),
    })
  }

  /**
   * Per-instance webhook. `headers` carries the secret that authenticates posts back
   * to the bridge (checked in http/inbound.ts). A header, not the query string, so
   * the secret stays out of access and proxy logs.
   */
  async setWebhook(
    instance: string,
    url: string,
    events: string[],
    secret: string,
  ): Promise<void> {
    await this.request(`/webhook/set/${encodeURIComponent(instance)}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url,
          events,
          // `byEvents` and `base64`, not `webhookByEvents` / `webhookBase64`: Evolution
          // reads only the short names (the long ones were silently ignored until 2026-09-11).
          // false keeps every event at one URL; true appends the event name, a route the bridge lacks.
          byEvents: false,
          // false leaves the file out of the webhook; the bridge fetches it via fetchMedia.
          base64: false,
          headers: { 'x-bridge-secret': secret },
        },
      }),
    })
  }
}
