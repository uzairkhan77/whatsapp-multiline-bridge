// Outbound: an agent replies in Chatwoot → message_created webhook → here → Evolution.
// Idempotent like the inbound side: the claim is taken before the webhook is answered,
// so a retry or a redelivery is dropped rather than sent twice.

// framework
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'

// storage
import { recordAgentActivity } from '../storage/agent-activity.js'
import {
  claimOutboundMessage,
  findOutboundByChatwootMessage,
  recordOutboundResult,
  releaseClaim,
} from '../storage/message-map.js'

// media
import { describeOutboundMedia, type OutboundMedia } from '../media/media.js'

// http routes and background jobs
import type { BridgeContext } from '../context.js'
import { attachmentsOn, type ChatwootWebhookBody } from './payloads.js'

// utilities
import { toE164, toEvolutionNumber, toWhatsAppJid } from '../core/phone.js'
import { secretMatches } from '../core/secrets.js'

/**
 * Outbound sends in flight, one chain per conversation. Sends race unevenly (text is a
 * two-millisecond call, a photo a five-second one), so chaining keeps one customer's
 * messages in the order the agent wrote them while different customers go in parallel.
 */
const outboundQueues = new Map<number, Promise<void>>()

function queueOutbound(log: FastifyBaseLogger, conversationId: number, work: () => Promise<void>): void {
  // Never rejects: a rejection would break the chain for every later message to this
  // customer and surface as an unhandled rejection. The work reports its own failures.
  const safe = () =>
    work().catch((error) => {
      log.error({ err: error, conversationId }, 'outbound work failed past its own handling')
    })

  const previous = outboundQueues.get(conversationId) ?? Promise.resolve()
  // Both arms, so the next message goes out whether the one before it worked.
  const next = previous.then(safe, safe)
  outboundQueues.set(conversationId, next)

  // Drop the entry once it settles, unless something newer has taken its place;
  // otherwise the map grows by one for every conversation ever written to.
  void next.finally(() => {
    if (outboundQueues.get(conversationId) === next) outboundQueues.delete(conversationId)
  })
}

/**
 * Send one Chatwoot message to WhatsApp: the words, the files, or both. Runs after the
 * webhook is answered, so a failure is told to the agent as a private note and the claim
 * is given back so the Retry button in Chatwoot gets a real second attempt.
 */
async function deliverOutbound(ctx: BridgeContext, args: {
  instance: string
  fallbackInstance: string | null
  claimRowId: number
  messageId: number
  conversationId: number
  e164: string
  content: string
  files: OutboundMedia[]
  log: FastifyBaseLogger
}): Promise<void> {
  const { instance, fallbackInstance, claimRowId, messageId, conversationId, e164, content, files, log } = args
  const { evolution, db, chatwoot } = ctx

  // The id of the first send, and by being set at all, that something went out: three
  // photos are three sends, and a failure on the third must not be retried from the top.
  let firstSentId: string | null = null
  const remember = (id: string | null) => {
    if (firstSentId === null) firstSentId = id ?? ''
  }

  try {
    // Which line carries this. The thread is the same either way, but the number the
    // customer sees it arrive from differs, so it is recorded rather than inferred later.
    let sendVia = instance
    const state = await evolution.connectionState(instance)
    if (state !== 'open') {
      if (!fallbackInstance) {
        throw new Error(`line ${instance} is ${state} and has no fallback configured`)
      }
      log.warn({ line: instance, state, fallback: fallbackInstance }, 'line is down, sending through the fallback')
      sendVia = fallbackInstance
    }

    const number = toEvolutionNumber(e164)

    // One file with text is a single WhatsApp message with a caption. Several files, or a
    // voice note (WhatsApp gives it no caption), means the words go as their own message,
    // sent first so they arrive as an introduction.
    const only = files.length === 1 ? files[0] : undefined
    const asCaption = content && only && !only.asVoiceNote ? content : null

    if (content && !asCaption) {
      remember((await evolution.sendText(sendVia, number, content)).messageId)
    }

    for (const file of files) {
      if (file.asVoiceNote) {
        // The voice-note endpoint plays in the chat like a held-to-talk recording
        // rather than arriving as a file to download.
        remember((await evolution.sendVoiceNote(sendVia, number, file.url)).messageId)
      } else {
        remember(
          (
            await evolution.sendMedia(sendVia, number, {
              mediatype: file.mediatype,
              media: file.url,
              fileName: file.fileName,
              caption: asCaption,
            })
          ).messageId,
        )
      }
    }

    // One Chatwoot message can be several WhatsApp ones; the ledger holds the first id.
    // An empty string means sent but Evolution named no id; null is stored as nothing sent.
    await recordOutboundResult(db, claimRowId, firstSentId || null, sendVia)

    log.info(
      { to: e164, via: sendVia, chatwootMessage: messageId, files: files.length },
      files.length > 0 ? 'message with files sent to WhatsApp' : 'message sent to WhatsApp',
    )
  } catch (error) {
    const partial = firstSentId !== null

    if (partial) {
      // Part of it reached the customer, so the claim stays and a retry is dropped as a
      // duplicate rather than sending those parts a second time.
      await recordOutboundResult(db, claimRowId, firstSentId || null, instance).catch(() => {})
    } else {
      // Nothing reached the customer, so the claim goes back and the agent's Retry
      // gets a real second attempt instead of being dropped as a duplicate.
      await releaseClaim(db, claimRowId).catch(() => {})
    }

    log.error(
      { err: error, messageId, conversationId, files: files.length, partial },
      partial
        ? 'sent part of the message to WhatsApp and then failed — not retrying, some of it has landed'
        : 'failed to send to WhatsApp',
    )

    // Chatwoot was already told the webhook was accepted, so its own tick cannot
    // carry this; tell the agent where they are looking.
    await chatwoot
      .createPrivateNote(
        conversationId,
        partial
          ? '[Not fully delivered. Part of this message reached the customer on WhatsApp and the rest did not. Check the chat before resending, so they do not receive the same thing twice.]'
          : '[Not delivered to WhatsApp. The customer has not received this. Use Retry to send it again.]',
      )
      .catch((noteError) => {
        log.error({ err: noteError, conversationId }, 'could not warn the agent that the send failed')
      })
  }
}

/**
 * Mirror a Chatwoot delete onto WhatsApp. An agent can only revoke what this line
 * itself sent, so a message with no evolution_message_id on record — never delivered,
 * or the customer's own — is left alone.
 */
async function deleteOnWhatsApp(ctx: BridgeContext, args: {
  chatwootMessageId: number
  conversationId: number
  e164: string
  log: FastifyBaseLogger
}): Promise<void> {
  const { chatwootMessageId, conversationId, e164, log } = args
  const { db, evolution, chatwoot } = ctx

  const mapped = await findOutboundByChatwootMessage(db, chatwootMessageId)
  if (!mapped || !mapped.evolutionMessageId) {
    return
  }

  try {
    await evolution.deleteMessage(mapped.sentViaInstance ?? mapped.instance, {
      id: mapped.evolutionMessageId,
      remoteJid: toWhatsAppJid(e164),
      fromMe: true,
    })
    log.info({ conversationId, chatwootMessageId }, 'delete mirrored to WhatsApp')
  } catch (error) {
    log.error(
      { err: error, conversationId, chatwootMessageId },
      'could not delete the message on WhatsApp',
    )
    await chatwoot
      .createPrivateNote(
        conversationId,
        '[Not deleted on WhatsApp. The customer can still see this message there.]',
      )
      .catch((noteError) => {
        log.error({ err: noteError, conversationId }, 'could not warn the agent that the WhatsApp delete failed')
      })
  }
}

export function registerOutbound(app: FastifyInstance, ctx: BridgeContext): void {
  const { config, db, lines, settings } = ctx

  app.post<{ Body: ChatwootWebhookBody; Querystring: { secret?: string } }>(
    '/webhooks/chatwoot',
    async (request, reply) => {
      // Chatwoot's inbox webhook cannot send custom headers, so the shared secret rides in
      // the query string. The settings store serves the last good value through a database
      // blip: answering 401 for "settings unreadable" would silently drop every agent reply.
      const chatwootSettings = await settings.get()
      if (!chatwootSettings) {
        request.log.error(
          'Chatwoot webhook rejected: no settings configured — set the account in the Operator Console',
        )
        return reply.code(401).send({ status: 'unauthorised' })
      }
      // Constant-time compare, like the Evolution header: this endpoint is open to the
      // internet and an attacker can measure how long each guess took. 401, no detail.
      if (!secretMatches(request.query.secret, chatwootSettings.webhookSecret)) {
        return reply.code(401).send({ status: 'unauthorised' })
      }

      const body = request.body ?? {}

      if (body.event === 'message_updated') {
        if (body.content_attributes?.deleted !== true) {
          return reply.code(200).send({ status: 'ignored', reason: 'not-a-delete' })
        }

        const conversationId = body.conversation?.id
        const messageId = body.id
        if (!messageId || !conversationId) {
          return reply.code(200).send({ status: 'ignored', reason: 'nothing-to-delete' })
        }

        const rawNumber =
          body.conversation?.meta?.sender?.phone_number ??
          body.conversation?.meta?.sender?.identifier ??
          ''
        const e164 = toE164(rawNumber, config.defaultCountryCode)
        if (!e164) {
          request.log.error({ conversationId, rawNumber }, 'no usable number on the conversation')
          return reply.code(200).send({ status: 'ignored', reason: 'no-number' })
        }

        // Answered now, the revoke sent afterwards — same reasoning as a send: Evolution's
        // round trip should not hold up Chatwoot's webhook. Own catch, so a rejection here
        // cannot surface as an unhandled one.
        void deleteOnWhatsApp(ctx, { chatwootMessageId: messageId, conversationId, e164, log: request.log }).catch(
          (error) => {
            request.log.error(
              { err: error, conversationId, messageId },
              'delete-on-WhatsApp failed past its own handling',
            )
          },
        )

        return reply.code(200).send({ status: 'accepted' })
      }

      if (body.event !== 'message_created') {
        return reply.code(200).send({ status: 'ignored', reason: `event ${body.event}` })
      }

      // `incoming` is the message this bridge just created; echoing it back to
      // WhatsApp would send the customer their own words.
      if (body.message_type !== 'outgoing') {
        return reply.code(200).send({ status: 'ignored', reason: 'not-outgoing' })
      }

      // The sender was at their desk. Noted before the private-note check, since writing to a
      // colleague is still working (rule 7, docs/03-availability.md; auto-offline.ts). Fire and forget.
      // 'user' only, so a bot does not count; the bridge's own failure note arrives as the API token's owner and does.
      if (body.sender?.type === 'user' && typeof body.sender.id === 'number') {
        void recordAgentActivity(db, body.sender.id, new Date()).catch((error) => {
          request.log.error({ err: error, agent: body.sender?.id }, 'could not record agent activity')
        })
      }

      // A private note is the agent talking to colleagues, not to the customer.
      if (body.private) {
        return reply.code(200).send({ status: 'ignored', reason: 'private-note' })
      }

      const inboxId = body.inbox?.id
      const line = inboxId ? await lines.byInboxId(inboxId) : undefined
      if (!line) {
        request.log.warn({ inboxId }, 'outgoing message from an inbox with no line configured')
        return reply.code(200).send({ status: 'ignored', reason: 'unknown-inbox' })
      }

      const content = (body.content ?? '').trim()
      const messageId = body.id
      const conversationId = body.conversation?.id
      if (!messageId || !conversationId) {
        return reply.code(200).send({ status: 'ignored', reason: 'nothing-to-send' })
      }

      // An attachment with no words is a whole message; no text only means the message is a file.
      const files = attachmentsOn(body)
        .map(describeOutboundMedia)
        .filter((m): m is NonNullable<typeof m> => m !== null)

      if (!content && files.length === 0) {
        return reply.code(200).send({ status: 'ignored', reason: 'nothing-to-send' })
      }

      const rawNumber =
        body.conversation?.meta?.sender?.phone_number ??
        body.conversation?.meta?.sender?.identifier ??
        ''
      const e164 = toE164(rawNumber, config.defaultCountryCode)
      if (!e164) {
        request.log.error({ conversationId, rawNumber }, 'no usable number on the conversation')
        return reply.code(200).send({ status: 'ignored', reason: 'no-number' })
      }

      const claim = await claimOutboundMessage(db, line.instance, messageId, conversationId)
      if (!claim.claimed) {
        request.log.info({ messageId }, 'duplicate Chatwoot webhook dropped')
        return reply.code(200).send({ status: 'duplicate' })
      }

      // Answered now, sent afterwards. Evolution takes four to five seconds to push a file and
      // Chatwoot gives the webhook less than that: waiting marked delivered files "Failed to
      // send" and turned Retry into a duplicate. The claim above is what makes answering early safe.
      queueOutbound(app.log, conversationId, () =>
        deliverOutbound(ctx, {
          instance: line.instance,
          fallbackInstance: line.fallbackInstance,
          claimRowId: claim.rowId!,
          messageId,
          conversationId,
          e164,
          content,
          files,
          log: request.log,
        }),
      )

      return reply.code(200).send({ status: 'accepted' })
    },
  )
}
