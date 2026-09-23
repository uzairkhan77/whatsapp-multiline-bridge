// Chatwoot client. Chatwoot is the system of record for conversations; the bridge
// only creates contacts, conversations and messages here and never mirrors them back.

// storage
import type { ChatwootSettings } from '../storage/chatwoot-settings.js'
import type { SingleRowStore } from '../storage/settings-store.js'

export interface ChatwootContact {
  id: number
  name?: string
  phone_number?: string
  contact_inboxes?: { source_id: string; inbox?: { id: number } }[]
}

export interface ChatwootConversation {
  id: number
  inbox_id: number
  status: string
}

/** An agent as Chatwoot reports it; `availability_status` is Chatwoot's own presence. */
export interface ChatwootAgent {
  id: number
  name?: string
  email?: string
  availability_status?: 'online' | 'busy' | 'offline'
  /** 'agent' or 'administrator'. Written back unchanged when setting availability, so the role is never altered. */
  role?: string
}

/** The half of a conversation listing the scripts and the auto-offline pass read. */
export interface ChatwootConversationSummary {
  id: number
  inboxId: number
  status: string
  /** Null when the conversation is sitting in the Unassigned pool. */
  assigneeId: number | null
  phoneE164: string | null
  /** Chatwoot's own `waiting_since`: set when a customer message has no reply outstanding, cleared by a non-private reply or a resolve. Null when nobody is waiting. */
  waitingSince: Date | null
}

/** Chatwoot's own shape for the above, declared only where it is unpacked. */
interface RawConversation {
  id: number
  inbox_id: number
  status?: string
  /** Seconds since the epoch. Zero — not null — is how "nobody is waiting" arrives. */
  waiting_since?: number | string | null
  meta?: {
    assignee?: { id?: number } | null
    sender?: { phone_number?: string } | null
  }
}

export class ChatwootError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'ChatwootError'
  }
}

export class ChatwootClient {
  // Credentials live in the database and can be rotated from the Operator Console, so
  // every request resolves them through the store (cached, so usually a memory read).
  constructor(private readonly settings: SingleRowStore<ChatwootSettings>) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const s = await this.settings.get()
    if (!s) {
      // 503 rather than a fetch TypeError on an undefined URL: upstream handlers log
      // ChatwootErrors with status and body, and this must read as "not configured".
      throw new ChatwootError(
        'Chatwoot is not configured — set the account in the Operator Console settings screen',
        503,
        '',
      )
    }

    const base = `${s.baseUrl}/api/v1/accounts/${s.accountId}`
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        api_access_token: s.apiToken,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    })

    const text = await response.text()
    if (!response.ok) {
      throw new ChatwootError(
        `Chatwoot ${init.method ?? 'GET'} ${path} failed with ${response.status}`,
        response.status,
        text.slice(0, 500),
      )
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  /**
   * Chatwoot's contact search is fuzzy (matches name and identifier too), so the
   * result is filtered to an exact E.164 digit match.
   */
  private async findContactByPhone(e164: string): Promise<ChatwootContact | null> {
    const query = encodeURIComponent(e164)
    const result = await this.request<{ payload?: ChatwootContact[] }>(
      `/contacts/search?q=${query}`,
    )
    const digits = e164.replace(/\D/g, '')
    return (
      result.payload?.find((c) => (c.phone_number ?? '').replace(/\D/g, '') === digits) ?? null
    )
  }

  private async getContact(id: number): Promise<ChatwootContact> {
    const result = await this.request<{ payload: ChatwootContact }>(`/contacts/${id}`)
    return result.payload
  }

  /**
   * Returns the contact and its source_id on this inbox. `source_id` is the E.164
   * number, not a uuid, so the same customer resolves to the same thread after a
   * restart or a re-import.
   */
  async ensureContact(
    inboxId: number,
    e164: string,
    name: string | null,
  ): Promise<{ contact: ChatwootContact; sourceId: string }> {
    let contact = await this.findContactByPhone(e164)

    if (!contact) {
      try {
        const created = await this.request<{ payload: { contact: ChatwootContact } }>(
          `/contacts`,
          {
            method: 'POST',
            body: JSON.stringify({
              inbox_id: inboxId,
              name: name || e164,
              phone_number: e164,
              source_id: e164,
            }),
          },
        )
        contact = created.payload.contact
      } catch (error) {
        // 422 is the race: another webhook created the contact between our search
        // and our insert. Re-read it.
        if (error instanceof ChatwootError && error.status === 422) {
          contact = await this.findContactByPhone(e164)
        }
        if (!contact) throw error
      }
    }

    const existing = contact.contact_inboxes?.find((ci) => ci.inbox?.id === inboxId)
    if (existing) {
      return { contact, sourceId: existing.source_id }
    }

    // Contact exists but not on this inbox (the customer wrote to another line
    // before): give it a presence here without duplicating it.
    await this.request(`/contacts/${contact.id}/contact_inboxes`, {
      method: 'POST',
      body: JSON.stringify({ inbox_id: inboxId, source_id: e164 }),
    })

    const refreshed = await this.getContact(contact.id)
    const created = refreshed.contact_inboxes?.find((ci) => ci.inbox?.id === inboxId)
    return { contact: refreshed, sourceId: created?.source_id ?? e164 }
  }

  /**
   * One customer on one line is one thread. Resolved conversations are reused, not
   * replaced; Chatwoot reopens them when the message lands.
   */
  async ensureConversation(
    contactId: number,
    inboxId: number,
    sourceId: string,
  ): Promise<{ conversation: ChatwootConversation; created: boolean }> {
    const result = await this.request<{ payload?: ChatwootConversation[] }>(
      `/contacts/${contactId}/conversations`,
    )

    const forInbox = (result.payload ?? []).filter((c) => c.inbox_id === inboxId)
    const open = forInbox.find((c) => c.status !== 'resolved')
    const reusable = open ?? forInbox.sort((a, b) => b.id - a.id)[0]
    // `created` tells assignment apart from an ordinary reply; without it the
    // rotation would count messages instead of customers.
    if (reusable) return { conversation: reusable, created: false }

    const conversation = await this.request<ChatwootConversation>(`/conversations`, {
      method: 'POST',
      body: JSON.stringify({
        source_id: sourceId,
        inbox_id: inboxId,
        contact_id: contactId,
        status: 'open',
      }),
    })
    return { conversation, created: true }
  }

  /** Every agent on the account, with the availability Chatwoot currently reports. */
  async listAgents(): Promise<ChatwootAgent[]> {
    return this.request<ChatwootAgent[]>(`/agents`)
  }

  /**
   * One page of the account's conversations. Used by the auto-offline pass,
   * never on the message path. Chatwoot pages 25 at a time and
   * answers an over-the-end page with an empty payload.
   */
  async listConversations(
    page: number,
    options: {
      /** 'all' by default. */
      status?: 'all' | 'open' | 'resolved' | 'pending'
      assigneeType?: 'all' | 'assigned' | 'unassigned'
      /** Chatwoot's own sort keys. `waiting_since_asc` lets the auto-offline pass stop at the first conversation inside the limit. */
      sortOn?: 'waiting_since_asc' | 'last_activity_at_desc'
    } = {},
  ): Promise<ChatwootConversationSummary[]> {
    const query = new URLSearchParams({
      status: options.status ?? 'all',
      assignee_type: options.assigneeType ?? 'all',
      page: String(page),
    })
    if (options.sortOn) query.set('sort_on', options.sortOn)

    const result = await this.request<{ data?: { payload?: RawConversation[] } }>(
      `/conversations?${query.toString()}`,
    )
    return (result.data?.payload ?? []).map((c) => ({
      id: c.id,
      inboxId: c.inbox_id,
      status: c.status ?? 'unknown',
      assigneeId: c.meta?.assignee?.id ?? null,
      phoneE164: c.meta?.sender?.phone_number ?? null,
      waitingSince: toDate(c.waiting_since),
    }))
  }

  /**
   * Set an agent's Online / Busy / Offline. `role` is sent back exactly as reported:
   * the update takes role and availability in one call, and this must never change
   * anyone's role. Signs nobody out and moves no conversations.
   */
  async setAgentAvailability(
    agentId: number,
    role: string,
    availability: 'online' | 'busy' | 'offline',
  ): Promise<void> {
    await this.request(`/agents/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role, availability }),
    })
  }

  async assignConversation(conversationId: number, assigneeId: number): Promise<void> {
    await this.request(`/conversations/${conversationId}/assignments`, {
      method: 'POST',
      body: JSON.stringify({ assignee_id: assigneeId }),
    })
  }

  /**
   * Put a conversation back in the Unassigned pool. `assignee_id: 0` rather than
   * null: zero is an id Chatwoot can never resolve, null reads as "field omitted".
   * Script use only; the message path never unassigns.
   */
  async unassignConversation(conversationId: number): Promise<void> {
    await this.request(`/conversations/${conversationId}/assignments`, {
      method: 'POST',
      body: JSON.stringify({ assignee_id: 0 }),
    })
  }

  async createIncomingMessage(
    conversationId: number,
    content: string,
    sourceId: string,
  ): Promise<{ id: number }> {
    return this.request<{ id: number }>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        message_type: 'incoming',
        private: false,
        source_id: sourceId,
      }),
    })
  }

  /**
   * A team-only note, used to tell the agent about a send that failed after the
   * webhook was already answered. `private: true` with `message_type: 'outgoing'`;
   * the outbound webhook handler ignores private messages, so it cannot loop back.
   */
  async createPrivateNote(conversationId: number, content: string): Promise<{ id: number }> {
    return this.request<{ id: number }>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, message_type: 'outgoing', private: true }),
    })
  }

  /**
   * Soft-delete: Chatwoot replaces the content with "This message was deleted" rather
   * than removing the row. Used to mirror a WhatsApp revoke into the conversation.
   */
  async deleteMessage(conversationId: number, messageId: number): Promise<void> {
    await this.request(`/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' })
  }

  /**
   * Incoming message with a file. Chatwoot takes attachments only as multipart, so
   * this bypasses `request` and lets fetch set the boundary header. `content` (the
   * caption) is optional; `private` is omitted because multipart fields are strings.
   */
  async createIncomingAttachment(
    conversationId: number,
    attachment: { bytes: Buffer; fileName: string; mimetype: string | null },
    content: string | null,
    sourceId: string,
  ): Promise<{ id: number }> {
    const s = await this.settings.get()
    if (!s) {
      throw new ChatwootError(
        'Chatwoot is not configured — set the account in the Operator Console settings screen',
        503,
        '',
      )
    }

    const form = new FormData()
    if (content) form.append('content', content)
    form.append('message_type', 'incoming')
    form.append('source_id', sourceId)
    form.append(
      'attachments[]',
      new Blob([new Uint8Array(attachment.bytes)], {
        // Without a type Chatwoot stores application/octet-stream and shows a
        // photo as a file to download.
        type: attachment.mimetype || 'application/octet-stream',
      }),
      attachment.fileName,
    )

    const base = `${s.baseUrl}/api/v1/accounts/${s.accountId}`
    const response = await fetch(`${base}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { api_access_token: s.apiToken },
      body: form,
      // 90s, against 20 for JSON calls: this pushes a file to Chatwoot Cloud. Pairs
      // with the 90s download before it and the 120s Evolution waits in evolution.env.
      signal: AbortSignal.timeout(90_000),
    })

    const text = await response.text()
    if (!response.ok) {
      throw new ChatwootError(
        `Chatwoot POST /conversations/${conversationId}/messages (attachment) failed with ${response.status}`,
        response.status,
        text.slice(0, 500),
      )
    }
    return (text ? JSON.parse(text) : {}) as { id: number }
  }
}

/**
 * Chatwoot timestamps are seconds since the epoch (Ruby `to_i`), and "nobody is
 * waiting" arrives as 0, not null. Read naively, 0 means "waiting since 1970" and
 * the auto-offline rule would take the whole team offline on its first pass.
 */
function toDate(value: number | string | null | undefined): Date | null {
  const seconds = typeof value === 'string' ? Number(value) : value
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000)
}
