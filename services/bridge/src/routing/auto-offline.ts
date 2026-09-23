// Sets an agent Offline when all three hold: they are Online or Busy, they have sent
// nothing for longer than the limit, and a customer assigned to them has waited longer
// than the limit for a reply. Nothing else changes: their conversations and Chatwoot
// sessions stay. The agent alone is emailed about each change. See docs/03-availability.md.

// framework
import type { FastifyBaseLogger } from 'fastify'

// storage
import { loadAgentActivity } from '../storage/agent-activity.js'
import { recordAgentTakenOffline } from '../storage/agent-offline-events.js'
import type { AutoOfflineSettings } from '../storage/auto-offline-settings.js'
import type { Db } from '../storage/db.js'
import type { SingleRowStore } from '../storage/settings-store.js'

// clients of other systems
import type { ChatwootAgent, ChatwootClient } from '../clients/chatwoot.js'
import type { Mailer } from '../clients/mailer.js'

// routing rules and alerts
import { agentTakenOffline } from '../alerts/alert-templates.js'

/** A customer waiting on a conversation somebody owns. */
export interface WaitingConversation {
  conversationId: number
  assigneeId: number
  waitingSince: Date
}

/** One agent about to be set Offline, and the evidence for it. */
export interface OfflineDecision {
  agent: ChatwootAgent
  /** The conversation that had been waiting longest. Recorded as the reason. */
  conversationId: number
  waitingSince: Date
  waitedMinutes: number
}

/**
 * Availability states that still receive new conversations. Busy is included on purpose:
 * Chatwoot hands new conversations to Busy agents too.
 */
const RECEIVING = new Set(['online', 'busy'])

/**
 * Which agents should be taken offline. Pure: this is the policy. An agent with no entry
 * in `lastActivity` counts as idle (a fresh deployment, or an agent who only works in
 * inboxes this bridge does not carry).
 */
export function agentsToTakeOffline(
  agents: ChatwootAgent[],
  waiting: WaitingConversation[],
  lastActivity: Map<number, number>,
  now: number,
  thresholdMs: number,
): OfflineDecision[] {
  const cutoff = now - thresholdMs

  // The longest-waiting conversation per agent, so the record names the customer let down most.
  const longestWait = new Map<number, WaitingConversation>()
  for (const conversation of waiting) {
    if (conversation.waitingSince.getTime() > cutoff) continue
    const held = longestWait.get(conversation.assigneeId)
    if (!held || conversation.waitingSince < held.waitingSince) {
      longestWait.set(conversation.assigneeId, conversation)
    }
  }

  const decisions: OfflineDecision[] = []

  for (const agent of agents) {
    if (!RECEIVING.has(agent.availability_status ?? '')) continue

    const spokeAt = lastActivity.get(agent.id)
    if (spokeAt !== undefined && spokeAt > cutoff) continue

    const conversation = longestWait.get(agent.id)
    if (!conversation) continue

    decisions.push({
      agent,
      conversationId: conversation.conversationId,
      waitingSince: conversation.waitingSince,
      waitedMinutes: Math.floor((now - conversation.waitingSince.getTime()) / 60_000),
    })
  }

  return decisions
}

/**
 * Pages of open conversations one pass will read: Chatwoot pages 25 at a time, so 1000
 * conversations. The walk stops at the first conversation inside the limit, so in practice
 * it reads one page; the cap protects against a genuine backlog.
 */
const MAX_PAGES = 40

export class AutoOffline {
  constructor(
    private readonly db: Db,
    private readonly chatwoot: ChatwootClient,
    private readonly settings: SingleRowStore<AutoOfflineSettings>,
    private readonly mailer: Mailer,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * One pass. Safe to repeat: an agent already Offline is not in `RECEIVING`. Throws only
   * if reading the settings or the agent list fails; everything after is per-agent.
   */
  async run(agents?: ChatwootAgent[]): Promise<void> {
    const settings = await this.settings.get()
    if (!settings?.enabled) return

    const thresholdMs = settings.thresholdMinutes * 60_000

    // The caller may hand over the agent list it just read, so one pass costs Chatwoot one listing.
    agents ??= await this.chatwoot.listAgents()
    const receiving = agents.filter((agent) => RECEIVING.has(agent.availability_status ?? ''))
    // Nobody is on, so nobody can be taken off; checked before the expensive conversation listing.
    if (receiving.length === 0) return

    const now = Date.now()
    const waiting = await this.waitingConversations(now - thresholdMs)
    if (waiting.length === 0) return

    const decisions = agentsToTakeOffline(
      receiving,
      waiting,
      await loadAgentActivity(this.db),
      now,
      thresholdMs,
    )

    for (const decision of decisions) {
      await this.takeOffline(decision, settings.thresholdMinutes)
    }
  }

  /**
   * Open conversations where the customer has been waiting since before `cutoff`. Asked for
   * longest-waiting-first, so the walk stops at the first conversation inside the limit. A
   * conversation with nobody waiting is skipped, since where Chatwoot sorts those is not relied on.
   */
  private async waitingConversations(cutoff: number): Promise<WaitingConversation[]> {
    const waiting: WaitingConversation[] = []

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const conversations = await this.chatwoot.listConversations(page, {
        status: 'open',
        assigneeType: 'assigned',
        sortOn: 'waiting_since_asc',
      })
      // Chatwoot answers an over-the-end page with an empty payload.
      if (conversations.length === 0) return waiting

      for (const conversation of conversations) {
        if (!conversation.waitingSince) continue
        if (conversation.waitingSince.getTime() > cutoff) return waiting
        if (conversation.assigneeId === null) continue

        waiting.push({
          conversationId: conversation.id,
          assigneeId: conversation.assigneeId,
          waitingSince: conversation.waitingSince,
        })
      }
    }

    this.log.warn(
      { pages: MAX_PAGES, found: waiting.length },
      'stopped reading waiting conversations at the page limit — the backlog is longer than one pass covers',
    )
    return waiting
  }

  /**
   * Set one agent Offline, record it, then email them, in that order so the record never
   * describes a change that did not happen. Failures are logged and swallowed: the next pass
   * retries the agent; a failed email is not retried, the record on the settings screen is the trace.
   */
  private async takeOffline(decision: OfflineDecision, thresholdMinutes: number): Promise<void> {
    const { agent } = decision
    const who = agent.email ?? agent.name ?? String(agent.id)

    try {
      // Role passed back unchanged (see setAgentAvailability). 'agent' is the Chatwoot default
      // and the safe guess if missing: sending 'administrator' would hand out permissions.
      await this.chatwoot.setAgentAvailability(agent.id, agent.role ?? 'agent', 'offline')
    } catch (error) {
      this.log.error(
        { err: error, agent: who, conversation: decision.conversationId },
        'could not set the agent offline',
      )
      return
    }

    try {
      await recordAgentTakenOffline(this.db, {
        agentId: agent.id,
        agentName: agent.name ?? null,
        agentEmail: agent.email ?? null,
        conversationId: decision.conversationId,
        waitingSince: decision.waitingSince,
        waitedMinutes: decision.waitedMinutes,
        thresholdMinutes,
      })
    } catch (error) {
      // The change already happened in Chatwoot; losing the record is not worth undoing it.
      this.log.error(
        { err: error, agent: who },
        'set the agent offline but could not record it',
      )
    }

    this.log.info(
      {
        agent: who,
        conversation: decision.conversationId,
        waitedMinutes: decision.waitedMinutes,
        thresholdMinutes,
      },
      'agent set offline — silent while a customer was waiting',
    )

    const email = agentTakenOffline(agent.name?.trim() || who, decision.conversationId, decision.waitedMinutes, thresholdMinutes)
    const address = agent.email?.trim()
    if (!address) {
      this.log.warn({ agent: who }, `${who} has no email on their Chatwoot account — telling the notification addresses only`)
    }
    const result = address
      ? await this.mailer.sendToPerson(address, email.subject, email.text)
      : await this.mailer.send(email.subject, email.text)
    if (result.sent > 0) {
      this.log.info(
        { agent: who, recipients: result.sent },
        address
          ? `emailed ${who} that they were set offline`
          : `emailed ${result.sent} notification address(es) that ${who} was set offline`,
      )
    } else {
      // A warning, not an error: the change itself succeeded and is on record.
      this.log.warn({ agent: who, reason: result.reason }, `${who} was set offline but NO EMAIL WAS SENT — ${result.reason}`)
    }
  }
}
