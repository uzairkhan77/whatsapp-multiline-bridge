// bridge.agent_activity — when each agent last said anything, one row per agent.

// storage
import type { Db } from './db.js'

/**
 * Upsert an agent's last-seen time; on the webhook hot path, so one statement and no read.
 * `greatest` so an out-of-order or redelivered older webhook can never move the time backwards.
 */
export async function recordAgentActivity(db: Db, agentId: number, at: Date): Promise<void> {
  await db.pool.query(
    `insert into bridge.agent_activity (chatwoot_agent_id, last_message_at)
     values ($1, $2)
     on conflict (chatwoot_agent_id) do update
        set last_message_at = greatest(bridge.agent_activity.last_message_at, excluded.last_message_at)`,
    [agentId, at],
  )
}

/**
 * When each agent last said anything, as milliseconds. An agent missing from the map
 * has never been seen saying anything; the caller treats that as idle.
 */
export async function loadAgentActivity(db: Db): Promise<Map<number, number>> {
  const result = await db.pool.query<{ agentId: number; lastAt: Date }>(
    `select chatwoot_agent_id as "agentId", last_message_at as "lastAt"
       from bridge.agent_activity`,
  )
  return new Map(result.rows.map((row) => [row.agentId, row.lastAt.getTime()]))
}
