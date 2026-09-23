// Records each agent's Chatwoot availability every fifteen minutes, one row per unbroken
// stretch of one status, for the Funnel's time-Online-per-day figures. A gap the bridge did
// not watch counts as neither Online nor Offline. A change is seen up to fifteen minutes late,
// and one that reverts inside a pass is never seen. Chatwoot's own auto-offline is off for
// every agent, so the status changes only by hand or via auto-offline.ts. See docs/03-availability.md.

// framework
import type { FastifyBaseLogger } from 'fastify'

// storage
import type { PresencePlan, PresenceRow, PresenceStatus } from '../storage/agent-presence.js'
import { loadLatestPresence, writePresenceTick } from '../storage/agent-presence.js'
import type { Db } from '../storage/db.js'

// clients of other systems
import type { ChatwootAgent, ChatwootClient } from '../clients/chatwoot.js'

/**
 * How often the agent pass runs: the presence record and the auto-offline rule together.
 * Fifteen minutes is the spacing the auto-offline rule was designed around (docs/03-availability.md)
 * and the resolution of the record.
 */
export const AGENT_PASS_EVERY_MS = 15 * 60_000

/**
 * How long after its last look a row may still be extended rather than closed: the pass
 * interval plus room for a slow Chatwoot answer or a late pass. Past it, a new row starts.
 */
export const EXTEND_TOLERANCE_MS = AGENT_PASS_EVERY_MS + 5 * 60_000

const KNOWN: ReadonlySet<string> = new Set(['online', 'busy', 'offline'])

/**
 * Chatwoot's word for the status, or 'unknown'. Recorded rather than skipped: "we looked
 * and could not tell" is different from no row at all.
 */
export function presenceStatus(status: string | undefined): PresenceStatus {
  return status !== undefined && KNOWN.has(status) ? (status as PresenceStatus) : 'unknown'
}

/**
 * What one look should write. Pure: this is the whole of the policy. An agent Chatwoot no
 * longer lists is left alone; an agent with no row yet opens one.
 */
export function planPresenceTick(
  agents: ChatwootAgent[],
  latest: Map<number, PresenceRow>,
  now: number,
  toleranceMs = EXTEND_TOLERANCE_MS,
): PresencePlan {
  const plan: PresencePlan = { extend: [], open: [] }

  for (const agent of agents) {
    const status = presenceStatus(agent.availability_status)
    const held = latest.get(agent.id)
    if (held && held.status === status && now - held.seenAt.getTime() <= toleranceMs) {
      plan.extend.push(held.id)
    } else {
      plan.open.push({ agentId: agent.id, status })
    }
  }

  return plan
}

export class PresenceLog {
  private running = false

  constructor(
    private readonly db: Db,
    private readonly chatwoot: ChatwootClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * One look; `agents` is Chatwoot's list if the caller just read it. Throws when Chatwoot
   * or the database cannot be reached, and the gap is left uncounted. A look still running
   * when the next is due is skipped, never overlapped.
   */
  async tick(agents?: ChatwootAgent[]): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      agents ??= await this.chatwoot.listAgents()
      if (agents.length === 0) {
        // An account with no agents is not a thing: an empty answer is a failed one that
        // came back 200, so nothing is written.
        this.log.warn('presence: Chatwoot listed no agents — this look is not recorded')
        return
      }

      const now = new Date()
      const plan = planPresenceTick(agents, await loadLatestPresence(this.db), now.getTime())
      await writePresenceTick(this.db, plan, now)

      // Quiet while nothing changes.
      if (plan.open.length > 0) {
        this.log.info(
          { opened: plan.open.map((row) => `${row.agentId}:${row.status}`) },
          'presence: a stretch began',
        )
      }
    } finally {
      this.running = false
    }
  }
}
