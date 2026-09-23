// bridge.agent_presence — what each agent's availability was, and for how long.
// Reasoning in docs/03-availability.md ("Recording who is Online").

// storage
import type { Db } from './db.js'

export type PresenceStatus = 'online' | 'busy' | 'offline' | 'unknown'

/** One stretch of one status for one agent, as bridge.agent_presence holds it. */
export interface PresenceRow {
  id: number
  agentId: number
  status: PresenceStatus
  sinceAt: Date
  seenAt: Date
}

/** What one tick decided to write — see planPresenceTick in presence.ts. */
export interface PresencePlan {
  /** Rows whose seen_at moves forward to now. */
  extend: number[]
  /** Agents starting a new stretch. */
  open: { agentId: number; status: PresenceStatus }[]
}

/** The latest row per agent — the only rows a tick can extend. */
export async function loadLatestPresence(db: Db): Promise<Map<number, PresenceRow>> {
  // bigserial comes back from pg as a string; everything else is already typed.
  const result = await db.pool.query<Omit<PresenceRow, 'id'> & { id: string }>(
    `select distinct on (chatwoot_agent_id)
            id, chatwoot_agent_id as "agentId", status, since_at as "sinceAt", seen_at as "seenAt"
       from bridge.agent_presence
      order by chatwoot_agent_id, seen_at desc`,
  )
  return new Map(result.rows.map((row) => [row.agentId, { ...row, id: Number(row.id) }]))
}

/**
 * Apply one tick's plan in two statements for the whole roster, not one per agent. No
 * transaction: a crash between them leaves rows valid on their own, and the next tick opens what is missing.
 */
export async function writePresenceTick(db: Db, plan: PresencePlan, now: Date): Promise<void> {
  if (plan.extend.length > 0) {
    await db.pool.query(`update bridge.agent_presence set seen_at = $1 where id = any($2::bigint[])`, [
      now,
      plan.extend,
    ])
  }
  if (plan.open.length > 0) {
    await db.pool.query(
      `insert into bridge.agent_presence (chatwoot_agent_id, status, since_at, seen_at)
       select agent_id, status, $1, $1
         from unnest($2::int[], $3::text[]) as t(agent_id, status)`,
      [now, plan.open.map((row) => row.agentId), plan.open.map((row) => row.status)],
    )
  }
}
