// The shapes of the two webhooks, and how to read the parts of them that matter.

// media
import { unwrapMessage, type ChatwootAttachment } from '../media/media.js'

// Payload shapes. Only the fields the bridge actually reads are declared.

export interface EvolutionWebhookBody {
  event?: string
  instance?: string
  data?: {
    key?: { remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean; id?: string }
    pushName?: string
    message?: Record<string, unknown>
    messageType?: string
    /** connection.update events: 'open' | 'close' | 'connecting'. */
    state?: string
    statusReason?: number
    /** messages.delete: the flat shape (no nested `key`) carries the id here directly. */
    id?: string
    /** messages.edited: the new content, in the same shape as an ordinary message. */
    editedMessage?: Record<string, unknown>
  }
}

export interface ChatwootWebhookBody {
  event?: string
  id?: number
  content?: string
  message_type?: string
  private?: boolean
  /** Set on message_updated when the message is a delete: content_attributes.deleted. */
  content_attributes?: { deleted?: boolean }
  /** Files the agent attached. Present on the message itself on a message_created. */
  attachments?: ChatwootAttachment[]
  /** Who wrote it: `type` is 'user' for a person and 'agent_bot' for a bot answering for them. */
  sender?: { id?: number; type?: string }
  inbox?: { id?: number }
  conversation?: {
    id?: number
    meta?: { sender?: { phone_number?: string; identifier?: string } }
    /** The same message again, nested; Chatwoot has moved the attachments between the two — see attachmentsOn. */
    messages?: { id?: number; attachments?: ChatwootAttachment[] }[]
  }
}

/**
 * The files on an outgoing Chatwoot message. Chatwoot puts them at the top level and inside
 * `conversation.messages[0]`; which one is populated differs by version, so both are tried.
 */
export function attachmentsOn(body: ChatwootWebhookBody): ChatwootAttachment[] {
  if (body.attachments?.length) return body.attachments

  // Only the message this webhook is about: the array can carry earlier messages in the
  // thread, and resending their files would send yesterday's photos on every reply.
  const nested = body.conversation?.messages?.find((m) => m.id === body.id)
  if (nested?.attachments?.length) return nested.attachments

  // No match by id. A single message in the array is unambiguously this one; several with
  // no match is refused, since guessing wrong resends a photo from an earlier message.
  const messages = body.conversation?.messages ?? []
  if (messages.length === 1 && messages[0]?.attachments?.length) return messages[0].attachments

  return []
}

/**
 * Evolution announces events as `messages.upsert` in the body but expects
 * `MESSAGES_UPSERT` when subscribing. Normalise so one spelling is compared.
 */
export function normaliseEvent(event: string | undefined): string {
  return (event ?? '').toLowerCase().replace(/_/g, '.')
}

/**
 * Plain text of a message, or null when it carries something else. Unwrapped first:
 * a disappearing message is ordinary text inside an `ephemeralMessage`.
 */
export function extractText(message: Record<string, unknown> | undefined): string | null {
  const unwrapped = unwrapMessage(message)
  if (!unwrapped) return null

  const conversation = unwrapped['conversation']
  if (typeof conversation === 'string' && conversation.length > 0) return conversation

  const extended = unwrapped['extendedTextMessage'] as { text?: string } | undefined
  if (typeof extended?.text === 'string' && extended.text.length > 0) return extended.text

  return null
}
