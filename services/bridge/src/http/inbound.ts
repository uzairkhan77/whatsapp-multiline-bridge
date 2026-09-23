// Inbound: WhatsApp → Evolution webhook → here → Chatwoot contact/conversation/message.
// Idempotent: a redelivered webhook is claimed in Postgres and dropped if the claim
// fails, so a retry cannot produce a second message.

// framework
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'

// storage
import {
  claimInboundMessage,
  findByEvolutionMessage,
  recordInboundResult,
  releaseClaim,
} from '../storage/message-map.js'

// media
import { ffmpegAvailable, needsTranscode, toMp3, TRANSCODED_MIMETYPE } from '../media/audio.js'
import { describeInboundMedia, inboundFileName, mediaDescription, type InboundMedia } from '../media/media.js'
import {
  contactFileName,
  contactsText,
  describeLocation,
  describeSharedContacts,
  locationText,
  type SharedContacts,
  type SharedLocation,
} from '../media/structured.js'

// http routes and background jobs
import type { BridgeContext } from '../context.js'
import { extractText, normaliseEvent, type EvolutionWebhookBody } from './payloads.js'

// utilities
import { isGroupJid, pickAddressableJid, toE164 } from '../core/phone.js'
import { secretMatches } from '../core/secrets.js'

/** `18.4 MB`, for a sentence an agent reads rather than a log field. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * A line of text about a file, in the bridge's voice: it stands in for a file that could
 * not be carried, or sits under one that was carried but is not quite right. The caption
 * comes first and unmarked (the customer's words); the note follows in brackets.
 */
function placeholderFor(media: InboundMedia, note: string): string {
  const bracketed = `[${mediaDescription(media)} — ${note}]`
  return media.caption ? `${media.caption}\n\n${bracketed}` : bracketed
}

/** Names the iPhone on purpose, so the agent opens it on a computer instead of hunting for a fault. */
const UNCONVERTED_AUDIO_NOTE =
  'could not be converted, so it may not play on an iPhone. ' +
  'Download it, or open this conversation on a computer, to listen.'

/**
 * Convert audio to MP3, or null when it cannot be done; every caller then sends the original.
 * A missing ffmpeg is reported once at boot and at debug here; a failure with ffmpeg present
 * is an error line every time.
 */
async function convertAudio(
  bytes: Buffer,
  context: { instance: string; media: InboundMedia; messageId: string; log: FastifyBaseLogger },
): Promise<Buffer | null> {
  const { instance, media, messageId, log } = context

  if (!(await ffmpegAvailable())) {
    log.debug({ instance, messageId }, 'ffmpeg is not installed — sending the audio unconverted')
    return null
  }

  try {
    const converted = await toMp3(bytes)
    log.info(
      {
        instance,
        messageId,
        kind: media.key,
        from: media.mimetype,
        bytesIn: bytes.byteLength,
        bytesOut: converted.byteLength,
      },
      'voice note converted so it plays on every device',
    )
    return converted
  } catch (error) {
    log.error(
      { err: error, instance, messageId, kind: media.key, mimetype: media.mimetype },
      'could not convert the audio — sending the original instead',
    )
    return null
  }
}

/**
 * Carry one inbound file into Chatwoot, as an attachment or as a note about it. Fetch/upload
 * failures are handled here, not thrown: a throw releases the claim and answers 502, which is
 * right for Chatwoot being down and wrong for a file WhatsApp will not give us. Chatwoot down still throws.
 */
async function deliverMedia(ctx: BridgeContext, args: {
  instance: string
  conversationId: number
  messageId: string
  media: InboundMedia
  payload: unknown
  log: FastifyBaseLogger
}): Promise<{ id: number }> {
  const { instance, conversationId, messageId, media, payload, log } = args
  const { chatwoot, evolution, config } = ctx
  const limit = config.maxInboundMediaBytes

  // WhatsApp states the size in the message itself, so an oversized file is known
  // before a byte of it is downloaded.
  if (media.fileLength !== null && media.fileLength > limit) {
    log.warn(
      { instance, kind: media.key, bytes: media.fileLength, limit },
      'file is over the size limit — delivering a note about it instead',
    )
    return chatwoot.createIncomingMessage(
      conversationId,
      placeholderFor(
        media,
        `${humanSize(media.fileLength)}, too large to show here. Ask the customer to send it another way.`,
      ),
      messageId,
    )
  }

  try {
    const file = await evolution.fetchMedia(instance, payload)

    // Checked again on what actually arrived: fileLength is what the sender
    // claimed, and a message that omits it would otherwise skip the limit.
    if (file.bytes.byteLength > limit) {
      log.warn(
        { instance, kind: media.key, bytes: file.bytes.byteLength, limit },
        'downloaded file is over the size limit — delivering a note about it instead',
      )
      return await chatwoot.createIncomingMessage(
        conversationId,
        placeholderFor(
          media,
          `${humanSize(file.bytes.byteLength)}, too large to show here. Ask the customer to send it another way.`,
        ),
        messageId,
      )
    }

    // Evolution's name and type win where it has them: it has seen the decrypted
    // file, while the message only says what the sender claimed.
    const mimetype = file.mimetype ?? media.mimetype
    const described: InboundMedia = {
      ...media,
      fileName: media.fileName ?? file.fileName,
      mimetype,
    }

    // A voice note, or audio in a format Apple cannot open, is converted to MP3 — see audio.ts.
    if (needsTranscode(mimetype, media.isVoiceNote)) {
      const converted = await convertAudio(file.bytes, { instance, media, messageId, log })

      if (converted) {
        return await chatwoot.createIncomingAttachment(
          conversationId,
          {
            bytes: converted,
            // fileName null on purpose: the original is named .ogg, and some players refuse
            // a file whose name disagrees with its contents. inboundFileName invents
            // `voice-note-<id>.mp3` from the new type.
            fileName: inboundFileName(
              { ...described, fileName: null, mimetype: TRANSCODED_MIMETYPE },
              messageId,
            ),
            mimetype: TRANSCODED_MIMETYPE,
          },
          media.caption,
          messageId,
        )
      }

      // Conversion was not possible. The original still plays on Android and desktop, so it
      // is delivered, with a line saying why an iPhone may show a player that stays silent.
      return await chatwoot.createIncomingAttachment(
        conversationId,
        { bytes: file.bytes, fileName: inboundFileName(described, messageId), mimetype },
        placeholderFor(described, UNCONVERTED_AUDIO_NOTE),
        messageId,
      )
    }

    return await chatwoot.createIncomingAttachment(
      conversationId,
      { bytes: file.bytes, fileName: inboundFileName(described, messageId), mimetype },
      media.caption,
      messageId,
    )
  } catch (error) {
    // Logged at error: each one is a customer whose photo an agent now reads a sentence about.
    log.error(
      { err: error, instance, kind: media.key, messageId },
      'could not carry the file into Chatwoot — delivering a note about it instead',
    )
    return chatwoot.createIncomingMessage(
      conversationId,
      placeholderFor(media, 'it could not be loaded. Ask the customer to send it again.'),
      messageId,
    )
  }
}

/**
 * Carry shared contacts into Chatwoot: the names and numbers as text, the card as a `.vcf`.
 * The text is the message; if the file upload fails, the text is posted on its own.
 */
async function deliverContacts(ctx: BridgeContext, args: {
  conversationId: number
  messageId: string
  shared: SharedContacts
  log: FastifyBaseLogger
}): Promise<{ id: number }> {
  const { conversationId, messageId, shared, log } = args
  const { chatwoot } = ctx
  const text = contactsText(shared.contacts)

  try {
    return await chatwoot.createIncomingAttachment(
      conversationId,
      {
        bytes: Buffer.from(shared.vcard, 'utf8'),
        fileName: contactFileName(shared.contacts),
        // Named explicitly so a phone offers to add it to the address book
        // rather than opening it as a wall of text.
        mimetype: 'text/vcard',
      },
      text,
      messageId,
    )
  } catch (error) {
    log.error(
      { err: error, conversation: conversationId, messageId },
      'could not attach the contact card — delivering the names and numbers on their own',
    )
    return chatwoot.createIncomingMessage(conversationId, text, messageId)
  }
}

/**
 * Put one inbound message into Chatwoot. The four kinds are alternatives: exactly one is
 * set, and the order of preference lives here.
 */
async function deliverInbound(ctx: BridgeContext, args: {
  conversationId: number
  instance: string
  messageId: string
  text: string | null
  media: InboundMedia | null
  contacts: SharedContacts | null
  location: SharedLocation | null
  payload: unknown
  log: FastifyBaseLogger
}): Promise<{ id: number }> {
  const { conversationId, instance, messageId, text, media, contacts, location, payload, log } =
    args
  const { chatwoot } = ctx

  if (media) {
    return deliverMedia(ctx, { instance, conversationId, messageId, media, payload, log })
  }
  if (contacts) {
    return deliverContacts(ctx, { conversationId, messageId, shared: contacts, log })
  }
  if (location) {
    return chatwoot.createIncomingMessage(conversationId, locationText(location), messageId)
  }
  return chatwoot.createIncomingMessage(conversationId, text!, messageId)
}

export function registerInbound(app: FastifyInstance, ctx: BridgeContext): void {
  const { config, db, lines, chatwoot, alerts } = ctx

  app.post<{ Params: { instance: string }; Body: EvolutionWebhookBody }>(
    '/webhooks/evolution/:instance',
    async (request, reply) => {
      // Evolution proves itself with the header set when the webhook was registered
      // (jobs/webhook-sync.ts, EvolutionClient.setWebhook). Constant-time compare, and
      // 401 with no detail: describing what was wrong only helps an attacker.
      if (!secretMatches(request.headers['x-bridge-secret'] as string | undefined, config.evolution.webhookSecret)) {
        request.log.warn(
          { instance: request.params.instance, ip: request.ip },
          'evolution webhook rejected: wrong or missing secret',
        )
        return reply.code(401).send({ status: 'unauthorised' })
      }

      const instance = request.params.instance
      const body = request.body ?? {}
      const event = normaliseEvent(body.event)

      const line = await lines.byInstance(instance)
      if (!line) {
        // Answer 200: an unconfigured line is our configuration problem, and making
        // Evolution retry forever does not fix it.
        request.log.warn({ instance }, 'webhook for a line that is not configured')
        return reply.code(200).send({ status: 'ignored', reason: 'unknown-line' })
      }

      if (event === 'connection.update') {
        request.log.info({ instance, data: body.data }, 'connection update')
        // Fire and return 200 immediately: the alert machinery waits out a grace period
        // and sends email, and a slow webhook response is how deliveries start timing out.
        alerts.onUpdate(instance, body.data?.state, body.data?.statusReason ?? null)
        return reply.code(200).send({ status: 'ok' })
      }

      if (event === 'messages.delete') {
        // Two payload shapes reach here: a customer's own revoke carries the key fields
        // flat on `data`, while one echoed back from our own deleteMessage call nests
        // them under `data.key`. Either way, the id is what message_map is keyed on.
        const evolutionMessageId = body.data?.key?.id ?? body.data?.id
        if (!evolutionMessageId) {
          return reply.code(200).send({ status: 'ignored', reason: 'no-message-id' })
        }

        const mapped = await findByEvolutionMessage(db, instance, evolutionMessageId)
        if (!mapped) {
          // Not a message we ever carried into Chatwoot — nothing to mirror.
          return reply.code(200).send({ status: 'ignored', reason: 'untracked-message' })
        }

        try {
          await chatwoot.deleteMessage(mapped.chatwootConversationId, mapped.chatwootMessageId)
          request.log.info(
            { instance, evolutionMessageId, conversation: mapped.chatwootConversationId },
            'delete mirrored from WhatsApp to Chatwoot',
          )
        } catch (error) {
          request.log.error(
            { err: error, instance, evolutionMessageId, conversation: mapped.chatwootConversationId },
            'could not mirror the WhatsApp delete into Chatwoot',
          )
        }

        return reply.code(200).send({ status: 'ok' })
      }

      if (event === 'messages.edited') {
        // Chatwoot has no way to edit a message in place (its API only ever changes
        // delivery status), so an edit is carried in as a new message rather than a
        // silent rewrite of the old one — the agent would otherwise never see it changed.
        const original = body.data?.key
        const evolutionMessageId = original?.id
        if (!evolutionMessageId || original?.fromMe) {
          return reply
            .code(200)
            .send({ status: 'ignored', reason: original?.fromMe ? 'from-me' : 'no-message-id' })
        }

        const mapped = await findByEvolutionMessage(db, instance, evolutionMessageId)
        if (!mapped) {
          return reply.code(200).send({ status: 'ignored', reason: 'untracked-message' })
        }

        const text = extractText(body.data?.editedMessage)
        if (!text) {
          // An edit to something other than plain text (a caption, say) — nothing to show.
          return reply.code(200).send({ status: 'ignored', reason: 'nothing-to-show' })
        }

        try {
          await chatwoot.createIncomingMessage(
            mapped.chatwootConversationId,
            `[The customer edited a message:]\n\n${text}`,
            `${evolutionMessageId}-edited`,
          )
          request.log.info(
            { instance, evolutionMessageId, conversation: mapped.chatwootConversationId },
            'edit mirrored from WhatsApp to Chatwoot',
          )
        } catch (error) {
          request.log.error(
            { err: error, instance, evolutionMessageId, conversation: mapped.chatwootConversationId },
            'could not mirror the WhatsApp edit into Chatwoot',
          )
        }

        return reply.code(200).send({ status: 'ok' })
      }

      if (event !== 'messages.upsert') {
        return reply.code(200).send({ status: 'ignored', reason: `event ${event}` })
      }

      // A line whose inbox was detached in the panel: its connection updates above
      // still alert, but its messages have nowhere to go.
      const inboxId = line.chatwootInboxId
      if (inboxId === null) {
        request.log.warn({ instance }, 'message for a line with no inbox attached')
        return reply.code(200).send({ status: 'ignored', reason: 'no-inbox' })
      }

      const key = body.data?.key
      const messageId = key?.id
      if (!messageId) {
        return reply.code(200).send({ status: 'ignored', reason: 'no-message-id' })
      }

      // Our own outbound message echoed back; forwarding it would post the agent's
      // reply into Chatwoot a second time as if the customer had sent it.
      if (key?.fromMe) {
        return reply.code(200).send({ status: 'ignored', reason: 'from-me' })
      }

      const jid = pickAddressableJid(key?.remoteJid, key?.remoteJidAlt)
      if (!jid || isGroupJid(jid)) {
        return reply.code(200).send({ status: 'ignored', reason: 'not-a-direct-chat' })
      }

      const e164 = toE164(jid, config.defaultCountryCode)
      if (!e164) {
        request.log.warn({ jid }, 'could not normalise sender to E.164')
        return reply.code(200).send({ status: 'ignored', reason: 'unnormalisable-number' })
      }

      // Text first, media only when there is no text: a photo with words is one Chatwoot
      // message with an attachment and a body, not a picture plus a separate line of text.
      const text = extractText(body.data?.message)
      const media = text ? null : describeInboundMedia(body.data?.message)

      // Neither words nor a file, but still sent on purpose: a shared contact or a
      // shared location — see structured.ts.
      const contacts = text || media ? null : describeSharedContacts(body.data?.message)
      const location =
        text || media || contacts ? null : describeLocation(body.data?.message)

      if (!text && !media && !contacts && !location) {
        // Genuinely nothing to carry: a reaction, a poll vote, a call notification. Logged
        // rather than dropped quietly, so a lost message can be told from one never sent.
        request.log.warn(
          { instance, from: e164, kind: body.data?.messageType },
          'message carries nothing we can forward',
        )
        return reply.code(200).send({ status: 'ignored', reason: 'nothing-to-forward' })
      }

      const claim = await claimInboundMessage(db, instance, messageId)
      if (!claim.claimed) {
        request.log.info({ instance, messageId }, 'duplicate webhook dropped')
        return reply.code(200).send({ status: 'duplicate' })
      }

      try {
        const { contact, sourceId } = await chatwoot.ensureContact(
          inboxId,
          e164,
          body.data?.pushName ?? null,
        )
        const { conversation } = await chatwoot.ensureConversation(
          contact.id,
          inboxId,
          sourceId,
        )
        const message = await deliverInbound(ctx, {
          conversationId: conversation.id,
          instance,
          messageId,
          text,
          media,
          contacts,
          location,
          payload: body.data,
          log: request.log,
        })

        await recordInboundResult(db, claim.rowId!, message.id, conversation.id)

        request.log.info(
          {
            instance,
            from: e164,
            conversation: conversation.id,
            message: message.id,
            ...(media ? { kind: media.key } : {}),
            ...(contacts ? { contacts: contacts.contacts.length } : {}),
          },
          media
            ? 'file delivered to Chatwoot'
            : contacts
              ? 'shared contact delivered to Chatwoot'
              : location
                ? 'shared location delivered to Chatwoot'
                : 'message delivered to Chatwoot',
        )

        return reply.code(200).send({ status: 'ok', conversationId: conversation.id })
      } catch (error) {
        // Give the claim back so Evolution's retry gets a real second attempt.
        await releaseClaim(db, claim.rowId!)
        request.log.error({ err: error, instance, messageId }, 'failed to deliver to Chatwoot')
        return reply.code(502).send({ status: 'error' })
      }
    },
  )
}
