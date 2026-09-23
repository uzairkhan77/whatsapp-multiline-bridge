// Who gets taken out of the rotation for having stopped working, and the email
// that tells them. The cases that matter most are the ones that must leave an agent alone.
// Run with: pnpm --filter @multiline/bridge test

// node
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// clients of other systems
import type { ChatwootAgent } from '../../src/clients/chatwoot.js'

// routing rules and alerts
import { agentTakenOffline, localTimestamp } from '../../src/alerts/alert-templates.js'
import { agentsToTakeOffline, type WaitingConversation } from '../../src/routing/auto-offline.js'

const NOW = Date.parse('2026-09-14T12:00:00Z')
const THRESHOLD_MS = 30 * 60_000

/** Minutes ago, as a timestamp. */
function minutesAgo(minutes: number): number {
  return NOW - minutes * 60_000
}

function agent(
  id: number,
  availability: ChatwootAgent['availability_status'],
  extra: Partial<ChatwootAgent> = {},
): ChatwootAgent {
  return { id, name: `Agent ${id}`, email: `agent${id}@example.com`, availability_status: availability, ...extra }
}

function waiting(assigneeId: number, minutes: number, conversationId = assigneeId * 100): WaitingConversation {
  return { conversationId, assigneeId, waitingSince: new Date(minutesAgo(minutes)) }
}

/** The common case: agent silent for an hour, customer waiting nearly as long. */
function decide(
  agents: ChatwootAgent[],
  conversations: WaitingConversation[],
  activity: [number, number][] = [],
) {
  return agentsToTakeOffline(agents, conversations, new Map(activity), NOW, THRESHOLD_MS)
}

describe('deciding which agents have stopped working', () => {
  it('takes an online agent offline when they are silent and a customer is waiting', () => {
    const decisions = decide([agent(1, 'online')], [waiting(1, 47)], [[1, minutesAgo(60)]])
    assert.equal(decisions.length, 1)
    assert.equal(decisions[0]?.agent.id, 1)
    assert.equal(decisions[0]?.conversationId, 100)
    assert.equal(decisions[0]?.waitedMinutes, 47)
  })

  it('takes a busy agent offline too, because busy agents still receive chats', () => {
    // The rotation hands work to a Busy agent on purpose, so an agent who went
    // home on Busy collects customers exactly like one who went home on Online.
    const decisions = decide([agent(1, 'busy')], [waiting(1, 47)], [[1, minutesAgo(60)]])
    assert.equal(decisions.length, 1)
  })

  it('leaves alone an agent who is silent but has nobody waiting', () => {
    // A quiet half hour is not going home. The original requirement said
    // explicitly that this case must not be touched.
    const decisions = decide([agent(1, 'online')], [], [[1, minutesAgo(60)]])
    assert.deepEqual(decisions, [])
  })

  it('leaves alone an agent who has a customer waiting but is clearly working', () => {
    // Behind on one conversation while answering others. Taking them offline
    // would punish the hardest-working person on the team.
    const decisions = decide([agent(1, 'online')], [waiting(1, 47)], [[1, minutesAgo(4)]])
    assert.deepEqual(decisions, [])
  })

  it('leaves alone an agent who is already offline', () => {
    const decisions = decide([agent(1, 'offline')], [waiting(1, 47)], [[1, minutesAgo(60)]])
    assert.deepEqual(decisions, [])
  })

  it('leaves alone an agent whose status Chatwoot does not report', () => {
    // This rule only ever removes people, so an unknown status means do nothing.
    const decisions = decide([agent(1, undefined)], [waiting(1, 47)], [[1, minutesAgo(60)]])
    assert.deepEqual(decisions, [])
  })

  it('treats an agent we have never seen speak as idle', () => {
    // A fresh deployment has no activity recorded for anyone. Reading that as
    // "everybody is active" would mean the rule never fires at all.
    const decisions = decide([agent(1, 'online')], [waiting(1, 47)])
    assert.equal(decisions.length, 1)
  })

  it('ignores a customer who has not been waiting long enough yet', () => {
    const decisions = decide([agent(1, 'online')], [waiting(1, 29)], [[1, minutesAgo(60)]])
    assert.deepEqual(decisions, [])
  })

  it('counts a wait of exactly the limit', () => {
    // Thirty minutes means thirty minutes. An off-by-one here fires a minute
    // later than the setting says.
    const decisions = decide([agent(1, 'online')], [waiting(1, 30)], [[1, minutesAgo(60)]])
    assert.equal(decisions.length, 1)
  })

  it('names the customer who has been waiting longest', () => {
    const decisions = decide(
      [agent(1, 'online')],
      [waiting(1, 35, 500), waiting(1, 90, 501), waiting(1, 40, 502)],
      [[1, minutesAgo(120)]],
    )
    assert.equal(decisions[0]?.conversationId, 501)
    assert.equal(decisions[0]?.waitedMinutes, 90)
  })

  it('judges each agent on their own conversations', () => {
    // Agent 2's waiting customer must not take agent 1 offline.
    const decisions = decide(
      [agent(1, 'online'), agent(2, 'online')],
      [waiting(2, 47)],
      [
        [1, minutesAgo(60)],
        [2, minutesAgo(60)],
      ],
    )
    assert.equal(decisions.length, 1)
    assert.equal(decisions[0]?.agent.id, 2)
  })

  it('takes several agents offline in one pass', () => {
    const decisions = decide(
      [agent(1, 'online'), agent(2, 'busy'), agent(3, 'online')],
      [waiting(1, 47), waiting(2, 55)],
      [
        [1, minutesAgo(60)],
        [2, minutesAgo(60)],
        [3, minutesAgo(2)],
      ],
    )
    assert.deepEqual(
      decisions.map((d) => d.agent.id),
      [1, 2],
    )
  })

  it('ignores a waiting conversation belonging to nobody it was given', () => {
    // Assigned to someone not in the agent list, e.g. removed from Chatwoot.
    const decisions = decide([agent(1, 'online')], [waiting(9, 47)], [[1, minutesAgo(60)]])
    assert.deepEqual(decisions, [])
  })
})

describe('the email sent to an agent who was set offline', () => {
  it('speaks to the agent, and names the limit and the customer who waited longest', () => {
    const email = agentTakenOffline('Sam', 501, 47, 30)
    assert.equal(email.subject, 'You were set Offline in Chatwoot for inactivity')
    assert.match(email.text, /^Hi Sam,/)
    assert.match(email.text, /You were set Offline in Chatwoot automatically/)
    assert.match(email.text, /more than\n30 minutes/)
    assert.match(email.text, /conversation #501/)
    assert.match(email.text, /waiting 47 minutes/)
  })

  it('says what has changed and asks nothing of them', () => {
    const email = agentTakenOffline('Sam', 501, 47, 30)
    assert.match(email.text, /no new customers are handed to you/)
    assert.doesNotMatch(email.text, /set yourself|back Online|copied/)
  })

  it('gives the time on their own clock, with the UTC stamp beside it', () => {
    const email = agentTakenOffline('Sam', 501, 47, 30)
    assert.match(email.text, /Time: \w{3} \d{1,2} \w{3} \d{4}, \d{2}:\d{2} \S+ \(.* UTC\)$/)
  })

  it('does not read like an outage', () => {
    // The line alerts shout DOWN and LOGGED OUT in the subject. This one must
    // not be mistaken for either on a phone at a glance.
    const email = agentTakenOffline('Sam', 501, 47, 30)
    assert.doesNotMatch(email.subject, /DOWN|LOGGED OUT/)
  })

  it('says "1 minute" for a single minute', () => {
    const email = agentTakenOffline('Sam', 501, 1, 1)
    assert.match(email.text, /waiting 1 minute at the time/)
  })
})

describe('the local timestamp', () => {
  it('shifts by the configured offset and names the zone', () => {
    const stamp = localTimestamp(new Date('2026-09-18T03:15:30Z'), 4, 'Dubai time')
    assert.equal(stamp, 'Fri 18 Sep 2026, 07:15 Dubai time (Fri 18 Sep 2026, 03:15:30 UTC)')
  })

  it('handles an offset behind UTC, where the local day is the one before', () => {
    const stamp = localTimestamp(new Date('2026-09-18T03:15:30Z'), -5, 'Bogota time')
    assert.equal(stamp, 'Thu 17 Sep 2026, 22:15 Bogota time (Fri 18 Sep 2026, 03:15:30 UTC)')
  })
})
