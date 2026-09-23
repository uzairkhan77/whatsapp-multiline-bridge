// bridge.message_map — one row per message carried, in either direction. The claim is
// the insert: a webhook redelivery loses the race on the unique index and is dropped.

// storage
import type { Db } from './db.js'

/**
 * Claim an inbound Evolution message; false means it was already handled and the redelivery
 * must be dropped. The insert is the claim: the unique index lets exactly one through, no read first.
 */
export async function claimInboundMessage(
  db: Db,
  instance: string,
  evolutionMessageId: string,
): Promise<{ claimed: boolean; rowId?: number }> {
  const result = await db.pool.query<{ id: string }>(
    `insert into bridge.message_map (instance, evolution_message_id, direction)
     values ($1, $2, 'inbound')
     on conflict do nothing
     returning id`,
    [instance, evolutionMessageId],
  )
  const row = result.rows[0]
  return row ? { claimed: true, rowId: Number(row.id) } : { claimed: false }
}

/** Same claim, for a message Chatwoot told us an agent sent. */
export async function claimOutboundMessage(
  db: Db,
  instance: string,
  chatwootMessageId: number,
  chatwootConversationId: number,
): Promise<{ claimed: boolean; rowId?: number }> {
  const result = await db.pool.query<{ id: string }>(
    `insert into bridge.message_map
       (instance, chatwoot_message_id, chatwoot_conversation_id, direction)
     values ($1, $2, $3, 'outbound')
     on conflict do nothing
     returning id`,
    [instance, chatwootMessageId, chatwootConversationId],
  )
  const row = result.rows[0]
  return row ? { claimed: true, rowId: Number(row.id) } : { claimed: false }
}

export async function recordInboundResult(
  db: Db,
  rowId: number,
  chatwootMessageId: number,
  chatwootConversationId: number,
): Promise<void> {
  await db.pool.query(
    `update bridge.message_map
        set chatwoot_message_id = $2, chatwoot_conversation_id = $3
      where id = $1`,
    [rowId, chatwootMessageId, chatwootConversationId],
  )
}

export async function recordOutboundResult(
  db: Db,
  rowId: number,
  evolutionMessageId: string | null,
  sentViaInstance: string,
): Promise<void> {
  await db.pool.query(
    `update bridge.message_map
        set evolution_message_id = $2, sent_via_instance = $3
      where id = $1`,
    [rowId, evolutionMessageId, sentViaInstance],
  )
}

/**
 * A claim that could not be completed must be removed, or the message looks handled
 * and the sender's retry — the one chance to recover — is dropped as a duplicate.
 */
export async function releaseClaim(db: Db, rowId: number): Promise<void> {
  await db.pool.query(`delete from bridge.message_map where id = $1`, [rowId])
}

export interface OutboundMapping {
  instance: string
  /** Null when the send never reached WhatsApp — nothing to revoke there. */
  evolutionMessageId: string | null
  /** The line actually carrying it, which can differ from `instance` on a fallback send. */
  sentViaInstance: string | null
}

/**
 * Find the WhatsApp side of a message an agent sent, so a delete in Chatwoot can be
 * mirrored. Outbound only: WhatsApp never lets us revoke a message the customer sent.
 */
export async function findOutboundByChatwootMessage(
  db: Db,
  chatwootMessageId: number,
): Promise<OutboundMapping | null> {
  const result = await db.pool.query<{
    instance: string
    evolution_message_id: string | null
    sent_via_instance: string | null
  }>(
    `select instance, evolution_message_id, sent_via_instance
       from bridge.message_map
      where chatwoot_message_id = $1 and direction = 'outbound'`,
    [chatwootMessageId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    instance: row.instance,
    evolutionMessageId: row.evolution_message_id,
    sentViaInstance: row.sent_via_instance,
  }
}

export interface ChatwootMapping {
  chatwootMessageId: number
  chatwootConversationId: number
}

/**
 * Find the Chatwoot side of a WhatsApp message, so a revoke there can be mirrored in.
 * Works for either direction: a customer's own message or an agent's echoed back.
 */
export async function findByEvolutionMessage(
  db: Db,
  instance: string,
  evolutionMessageId: string,
): Promise<ChatwootMapping | null> {
  const result = await db.pool.query<{
    chatwoot_message_id: string | null
    chatwoot_conversation_id: string | null
  }>(
    `select chatwoot_message_id, chatwoot_conversation_id
       from bridge.message_map
      where instance = $1 and evolution_message_id = $2`,
    [instance, evolutionMessageId],
  )
  const row = result.rows[0]
  if (!row || row.chatwoot_message_id === null || row.chatwoot_conversation_id === null) return null
  return {
    chatwootMessageId: Number(row.chatwoot_message_id),
    chatwootConversationId: Number(row.chatwoot_conversation_id),
  }
}
