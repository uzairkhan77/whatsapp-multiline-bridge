// What one look at Chatwoot's agent list writes into the presence record. The
// boundaries matter: a slightly late look still extends the row; a gap must not.
// Run with: pnpm --filter @multiline/bridge test

// node
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// storage
import type { PresenceRow, PresenceStatus } from '../../src/storage/agent-presence.js'

// clients of other systems
import type { ChatwootAgent } from '../../src/clients/chatwoot.js'

// routing rules and alerts
import { EXTEND_TOLERANCE_MS, planPresenceTick, presenceStatus } from '../../src/routing/presence.js'

const NOW = Date.parse('2026-09-17T12:00:00Z')

function agent(id: number, availability?: ChatwootAgent['availability_status']): ChatwootAgent {
  return { id, name: `Agent ${id}`, availability_status: availability }
}

/** A row last seen `secondsAgo` seconds before NOW, with a row id of agentId * 10. */
function row(agentId: number, status: PresenceStatus, secondsAgo: number): [number, PresenceRow] {
  const seenAt = new Date(NOW - secondsAgo * 1000)
  return [agentId, { id: agentId * 10, agentId, status, sinceAt: new Date(seenAt.getTime() - 3_600_000), seenAt }]
}

describe('reading a status off Chatwoot', () => {
  it('keeps the three it knows', () => {
    assert.equal(presenceStatus('online'), 'online')
    assert.equal(presenceStatus('busy'), 'busy')
    assert.equal(presenceStatus('offline'), 'offline')
  })

  it('records anything else as unknown rather than dropping the look', () => {
    assert.equal(presenceStatus(undefined), 'unknown')
    assert.equal(presenceStatus('away'), 'unknown')
  })
})

describe('deciding what one look writes', () => {
  it('opens a row for every agent when there is no record yet', () => {
    const plan = planPresenceTick([agent(1, 'online'), agent(2, 'offline')], new Map(), NOW)
    assert.deepEqual(plan, {
      extend: [],
      open: [
        { agentId: 1, status: 'online' },
        { agentId: 2, status: 'offline' },
      ],
    })
  })

  it('extends the row when the status is unchanged and the last look was a pass ago', () => {
    const plan = planPresenceTick([agent(1, 'online')], new Map([row(1, 'online', 15 * 60)]), NOW)
    assert.deepEqual(plan, { extend: [10], open: [] })
  })

  it('extends a row seen exactly at the tolerance', () => {
    // The limit is inclusive.
    const plan = planPresenceTick(
      [agent(1, 'online')],
      new Map([row(1, 'online', EXTEND_TOLERANCE_MS / 1000)]),
      NOW,
    )
    assert.deepEqual(plan, { extend: [10], open: [] })
  })

  it('opens a new row after a gap longer than the tolerance, even with the same status', () => {
    // The bridge was down for half an hour. Time nobody watched must not be
    // counted as Online, so the old row is left where it stopped.
    const plan = planPresenceTick([agent(1, 'online')], new Map([row(1, 'online', 30 * 60)]), NOW)
    assert.deepEqual(plan, { extend: [], open: [{ agentId: 1, status: 'online' }] })
  })

  it('opens a new row when the status changed', () => {
    const plan = planPresenceTick([agent(1, 'busy')], new Map([row(1, 'online', 15 * 60)]), NOW)
    assert.deepEqual(plan, { extend: [], open: [{ agentId: 1, status: 'busy' }] })
  })

  it('opens an unknown row for a status it cannot read', () => {
    const plan = planPresenceTick([agent(1, undefined)], new Map([row(1, 'online', 15 * 60)]), NOW)
    assert.deepEqual(plan, { extend: [], open: [{ agentId: 1, status: 'unknown' }] })
  })

  it('leaves alone an agent who has rows but is no longer listed', () => {
    // Removed from Chatwoot: their last row stops growing, nothing else.
    const plan = planPresenceTick([agent(1, 'online')], new Map([row(1, 'online', 15 * 60), row(9, 'online', 15 * 60)]), NOW)
    assert.deepEqual(plan, { extend: [10], open: [] })
  })

  it('handles a whole roster in one plan', () => {
    const plan = planPresenceTick(
      [agent(1, 'online'), agent(2, 'busy'), agent(3, 'offline'), agent(4, 'online')],
      new Map([row(1, 'online', 15 * 60), row(2, 'online', 15 * 60), row(3, 'offline', 30 * 60)]),
      NOW,
    )
    assert.deepEqual(plan, {
      extend: [10],
      open: [
        { agentId: 2, status: 'busy' },
        { agentId: 3, status: 'offline' },
        { agentId: 4, status: 'online' },
      ],
    })
  })
})
