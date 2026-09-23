// The arithmetic under the Funnel's two day-by-day tables.
//
// The cases worth being exact about are the edges: a stretch that crosses
// midnight has to land on both days and add up to itself, and a day the bridge
// was not watching has to come out as "—", never as "0m".
//
// Run with: pnpm --filter @multiline/panel test

// node
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// types
import type { AgentDays, PresenceInterval } from '@/types/agent-days'

// lib
import {
  bucketPresence,
  listDays,
  agentPeriodStats,
  onlineTotals,
  parseReplySeries,
  replyByDay,
  replyAxis,
  replySeries,
  rungLabel,
  samplePresence,
} from './agent-days'

/** A wall-clock time in the business timezone, as an ISO string with its offset. */
const cr = (day: string, time: string) => `${day}T${time}:00-06:00`

// Seven business days, 10 to 16 September. Their midnights are 06:00 UTC.
const FROM = new Date(cr('2026-09-10', '00:00'))
const TO = new Date(cr('2026-09-17', '00:00'))

function stretch(agentId: number, status: string, sinceAt: string, seenAt: string): PresenceInterval {
  return { agentId, status, sinceAt, seenAt }
}

describe('the days of the table', () => {
  it('lists every business day in the range, newest first', () => {
    assert.deepEqual(listDays(FROM, TO), [
      '2026-09-16',
      '2026-09-15',
      '2026-09-14',
      '2026-09-13',
      '2026-09-12',
      '2026-09-11',
      '2026-09-10',
    ])
  })

  it('is one day for a one-day range', () => {
    assert.deepEqual(listDays(FROM, new Date(cr('2026-09-11', '00:00'))), ['2026-09-10'])
  })
})

describe('adding up Online time by day', () => {
  it('counts a stretch inside one day against that day', () => {
    const out = bucketPresence([stretch(1, 'online', cr('2026-09-12', '09:00'), cr('2026-09-12', '11:30'))], FROM, TO)
    assert.equal(out.online[1]?.['2026-09-12'], 2.5 * 3600)
    assert.equal(out.recorded[1]?.['2026-09-12'], true)
  })

  it('splits a stretch that crosses midnight across both days, adding up to the whole', () => {
    const out = bucketPresence([stretch(1, 'online', cr('2026-09-12', '22:00'), cr('2026-09-13', '03:00'))], FROM, TO)
    assert.equal(out.online[1]?.['2026-09-12'], 2 * 3600)
    assert.equal(out.online[1]?.['2026-09-13'], 3 * 3600)
    assert.equal(out.recorded[1]?.['2026-09-13'], true)
  })

  it('keeps an evening shift on one day, though it crosses midnight UTC', () => {
    // 4pm to 10pm in the business timezone is 22:00 to 04:00 UTC. That used to land on two
    // rows; it is one evening and one row.
    const out = bucketPresence([stretch(1, 'online', '2026-09-12T22:00:00Z', '2026-09-13T04:00:00Z')], FROM, TO)
    assert.equal(out.online[1]?.['2026-09-12'], 6 * 3600)
    assert.equal(out.online[1]?.['2026-09-13'], undefined)
  })

  it('clips a stretch that began before the range', () => {
    const out = bucketPresence([stretch(1, 'online', cr('2026-09-09', '20:00'), cr('2026-09-10', '02:00'))], FROM, TO)
    assert.equal(out.online[1]?.['2026-09-09'], undefined)
    assert.equal(out.online[1]?.['2026-09-10'], 2 * 3600)
  })

  it('clips a stretch that runs past the range', () => {
    const out = bucketPresence([stretch(1, 'online', cr('2026-09-16', '23:00'), cr('2026-09-17', '05:00'))], FROM, TO)
    assert.equal(out.online[1]?.['2026-09-16'], 3600)
    assert.equal(out.online[1]?.['2026-09-17'], undefined)
  })

  it('keeps Busy apart from Online', () => {
    const out = bucketPresence(
      [
        stretch(1, 'online', cr('2026-09-12', '09:00'), cr('2026-09-12', '10:00')),
        stretch(1, 'busy', cr('2026-09-12', '10:00'), cr('2026-09-12', '10:30')),
      ],
      FROM,
      TO,
    )
    assert.equal(out.online[1]?.['2026-09-12'], 3600)
    assert.equal(out.busy[1]?.['2026-09-12'], 1800)
  })

  it('marks a day recorded for an Offline stretch without adding any time', () => {
    const out = bucketPresence([stretch(1, 'offline', cr('2026-09-12', '09:00'), cr('2026-09-12', '17:00'))], FROM, TO)
    assert.equal(out.recorded[1]?.['2026-09-12'], true)
    assert.equal(out.online[1]?.['2026-09-12'], undefined)
    assert.equal(out.busy[1]?.['2026-09-12'], undefined)
  })

  it('records each agent on their own days', () => {
    const out = bucketPresence([stretch(2, 'offline', cr('2026-09-12', '09:00'), cr('2026-09-12', '17:00'))], FROM, TO)
    assert.equal(out.recorded[1], undefined)
    assert.equal(out.recorded[2]?.['2026-09-12'], true)
  })

  it('ignores a stretch of no length and one outside the range', () => {
    const out = bucketPresence(
      [
        stretch(1, 'online', cr('2026-09-12', '09:00'), cr('2026-09-12', '09:00')),
        stretch(1, 'online', cr('2026-09-01', '09:00'), cr('2026-09-01', '17:00')),
      ],
      FROM,
      TO,
    )
    assert.deepEqual(out, { online: {}, busy: {}, recorded: {} })
  })

  it('accepts timestamps as Dates as well as strings', () => {
    const out = bucketPresence(
      [{ agentId: 1, status: 'online', sinceAt: new Date(cr('2026-09-12', '09:00')), seenAt: new Date(cr('2026-09-12', '10:00')) }],
      FROM,
      TO,
    )
    assert.equal(out.online[1]?.['2026-09-12'], 3600)
  })
})

describe("reading Chatwoot's reply-time series", () => {
  // The report is asked in the business offset, so each point sits at a Costa
  // Rica midnight.
  const ts = (day: string) => Date.parse(cr(day, '00:00')) / 1000

  it('turns a point per day into seconds, and zero into null', () => {
    const out = parseReplySeries(
      [
        { timestamp: ts('2026-09-12'), value: 113.69, count: 26 },
        { timestamp: ts('2026-09-13'), value: 0, count: 0 },
      ],
      FROM,
      TO,
    )
    assert.deepEqual(out, [
      { day: '2026-09-12', seconds: 113.69 },
      { day: '2026-09-13', seconds: null },
    ])
  })

  it('drops days outside the range and points it cannot read', () => {
    const out = parseReplySeries(
      [
        { timestamp: ts('2026-09-09'), value: 50 },
        { timestamp: ts('2026-09-17'), value: 50 },
        { timestamp: 'yesterday', value: 50 },
        { timestamp: ts('2026-09-12'), value: 'n/a' },
      ],
      FROM,
      TO,
    )
    assert.deepEqual(out, [{ day: '2026-09-12', seconds: null }])
  })

  it('is empty for anything that is not a list', () => {
    assert.deepEqual(parseReplySeries({ error: 'nope' }, FROM, TO), [])
  })

  it('keys the series by agent and day', () => {
    const out = replyByDay(new Map([[7, [{ day: '2026-09-12', seconds: 90 }]]]))
    assert.deepEqual(out, { 7: { '2026-09-12': 90 } })
  })
})

describe('what the charts are given', () => {
  const base: AgentDays = {
    days: ['2026-09-13', '2026-09-12'],
    agents: [
      { id: 1, name: 'Ana' },
      { id: 2, name: 'Ben' },
    ],
    reply: { seconds: { 1: { '2026-09-12': 90 } }, missing: [2] },
    presence: {
      online: { 1: { '2026-09-12': 4 * 3600 } },
      busy: { 1: { '2026-09-12': 1800 } },
      recorded: { 1: { '2026-09-12': true, '2026-09-13': true } },
      since: '2026-09-12',
    },
    presenceMissing: false,
    lineFilterIgnored: false,
  }

  it('lays the reply series out oldest day first, one value per agent, null for no replies or no answer', () => {
    assert.deepEqual(replySeries(base), [
      { day: '2026-09-12', '1': 90, '2': null },
      { day: '2026-09-13', '1': null, '2': null },
    ])
  })

  it('adds each agent up over the period for the bar per agent', () => {
    assert.deepEqual(onlineTotals(base), [
      { id: 1, name: 'Ana', online: 4 * 3600, busy: 1800, recordedDays: 2 },
      { id: 2, name: 'Ben', online: 0, busy: 0, recordedDays: 0 },
    ])
  })

  it("gives the table each agent's period figures, null where there is nothing", () => {
    assert.deepEqual(agentPeriodStats(base), {
      1: { avgReplySeconds: 90, onlineSeconds: 4 * 3600 },
      2: { avgReplySeconds: null, onlineSeconds: null },
    })
    assert.deepEqual(agentPeriodStats(null), {})
  })

  it('is all null when a source is missing altogether', () => {
    const reply = replySeries({ ...base, reply: null })
    assert.ok(reply.every((point) => point['1'] === null && point['2'] === null))
  })
})

describe('the reply-time axis', () => {
  it('runs from the rung below the quickest reply to the rung above the slowest', () => {
    // 2 minutes to 19 hours: the range in the first live screenshot.
    const axis = replyAxis(120, 19 * 3600)
    assert.equal(axis.floor, 120)
    assert.equal(axis.ceil, 24 * 3600)
    assert.ok(axis.ticks.length <= 7, `${axis.ticks.length} ticks`)
    assert.equal(axis.ticks[0], 120)
    assert.equal(axis.ticks[axis.ticks.length - 1], 24 * 3600)
  })

  it('still gives an axis with two rungs for a single reading', () => {
    const axis = replyAxis(300, 300)
    assert.deepEqual(axis, { floor: 300, ceil: 900, ticks: [300, 900] })
  })

  it('never goes below ten seconds, which a log axis cannot start at zero for', () => {
    assert.equal(replyAxis(0, 45).floor, 10)
  })

  it('labels rungs in whole units', () => {
    assert.equal(rungLabel(30), '30s')
    assert.equal(rungLabel(300), '5m')
    assert.equal(rungLabel(3600), '1h')
    assert.equal(rungLabel(86_400), '1d')
  })
})

describe('the sample readings for local testing', () => {
  const agents = [{ id: 1 }, { id: 2 }, { id: 3 }]
  const NOW = new Date(cr('2026-09-17', '14:00'))

  it('is the same every time and stays inside the period', () => {
    const a = samplePresence(agents, FROM, TO, NOW)
    const b = samplePresence(agents, FROM, TO, NOW)
    assert.deepEqual(a, b)
    assert.ok(a.length > 0)
    assert.ok(a.every((row) => new Date(row.sinceAt) >= FROM && new Date(row.seenAt) <= NOW))
  })

  it('gives every agent Online and Busy time, and leaves the third day unrecorded', () => {
    const out = bucketPresence(samplePresence(agents, FROM, TO, NOW), FROM, TO)
    for (const agent of agents) {
      assert.ok(Object.keys(out.online[agent.id] ?? {}).length > 0, `agent ${agent.id} online`)
      assert.ok(Object.keys(out.busy[agent.id] ?? {}).length > 0, `agent ${agent.id} busy`)
      assert.equal(out.recorded[agent.id]?.['2026-09-12'], undefined)
    }
  })
})
