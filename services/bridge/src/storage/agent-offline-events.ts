// bridge.agent_offline_events — every time an agent was set Offline by the inactivity
// rule, and why (docs/03-availability.md). Append-only.

// storage
import type { Db } from './db.js'

export interface AgentOfflineEvent {
  agentId: number
  agentName: string | null
  agentEmail: string | null
  conversationId: number | null
  waitingSince: Date | null
  waitedMinutes: number | null
  thresholdMinutes: number
}

/** The record of one agent being set Offline — who, when, and which customer was waiting. */
export async function recordAgentTakenOffline(db: Db, event: AgentOfflineEvent): Promise<void> {
  await db.pool.query(
    `insert into bridge.agent_offline_events
       (chatwoot_agent_id, agent_name, agent_email, chatwoot_conversation_id,
        waiting_since, waited_minutes, threshold_minutes)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      event.agentId,
      event.agentName,
      event.agentEmail,
      event.conversationId,
      event.waitingSince,
      event.waitedMinutes,
      event.thresholdMinutes,
    ],
  )
}
