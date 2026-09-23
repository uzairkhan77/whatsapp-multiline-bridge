// node
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// enums
import { Period } from '@/enums/period'
import { FunnelSortKey, SortDir } from '@/enums/sort'

// types
import type { AgentFunnelRow } from '@/types/funnel'

// lib
import { DATA_STARTS, buildAgentRow, buildTrend, dayOf, resolveRange, sortAgents } from './funnel-math'

describe('the dates counted over', () => {
  // 7am on 15 September in the business timezone. Every boundary below is a business
  // midnight, which is 06:00 UTC.
  const NOW = new Date('2026-09-15T13:00:00Z')

  it('never starts before the first day there is conversation data for', () => {
    for (const period of [Period.Days30, Period.Days90, Period.All]) {
      const range = resolveRange({ period }, NOW)
      assert.equal(range.from.getTime(), DATA_STARTS.getTime(), `period ${period}`)
      assert.equal(range.clamped, period !== Period.All, `period ${period} clamped flag`)
    }
  })

  it('does not claim to have clamped a range that already fits', () => {
    const range = resolveRange({ period: Period.Days7 }, NOW)
    assert.equal(range.clamped, false)
    assert.equal(dayOf(range.from), '2026-09-09')
  })

  it('counts today as today, not as yesterday', () => {
    // The upper bound is exclusive, so it has to sit at the start of tomorrow or
    // every sale made today disappears until the next morning.
    const range = resolveRange({ period: Period.Today }, NOW)
    assert.equal(dayOf(range.from), '2026-09-15')
    assert.equal(range.from.toISOString(), '2026-09-15T06:00:00.000Z')
    assert.equal(range.to.toISOString(), '2026-09-16T06:00:00.000Z')
  })

  it('keeps an evening in the business timezone on the day it is there', () => {
    // 9pm on the 15th in the business timezone is 3am on the 16th in UTC. "Today" is still
    // the 15th, and the sale made at 9pm counts on it.
    const evening = new Date('2026-09-16T03:00:00Z')
    const range = resolveRange({ period: Period.Today }, evening)
    assert.equal(dayOf(range.from), '2026-09-15')
    assert.ok(range.from <= evening && evening < range.to)
  })

  it('makes yesterday one whole day, ending at midnight', () => {
    const range = resolveRange({ period: Period.Yesterday }, NOW)
    assert.equal(range.from.toISOString(), '2026-09-14T06:00:00.000Z')
    assert.equal(range.to.toISOString(), '2026-09-15T06:00:00.000Z')
    assert.equal(range.clamped, false)
  })

  it('includes the last day of a custom range', () => {
    const range = resolveRange({ period: Period.Custom, from: '2026-09-05', to: '2026-09-10' }, NOW)
    assert.equal(dayOf(range.from), '2026-09-05')
    assert.equal(range.to.toISOString(), '2026-09-11T06:00:00.000Z')
  })

  it('will not report on days that have not happened yet', () => {
    const range = resolveRange({ period: Period.Custom, from: '2026-09-10', to: '2026-12-31' }, NOW)
    assert.equal(range.to.toISOString(), '2026-09-16T06:00:00.000Z')
  })

  it('clamps a custom range that reaches back before the data does', () => {
    const range = resolveRange({ period: Period.Custom, from: '2026-05-01', to: '2026-09-10' }, NOW)
    assert.equal(range.from.getTime(), DATA_STARTS.getTime())
    assert.equal(range.clamped, true)
  })

  it('survives a date typed by hand into the URL', () => {
    const range = resolveRange({ period: Period.Custom, from: 'not-a-date' }, NOW)
    assert.equal(range.from.getTime(), DATA_STARTS.getTime())
    assert.ok(range.to > range.from)
  })

  it('never returns a range that ends before it starts', () => {
    const range = resolveRange({ period: Period.Custom, from: '2026-09-10', to: '2026-09-05' }, NOW)
    assert.ok(range.to > range.from, 'upper bound must stay above the lower')
  })
})

describe('an agent row', () => {
  it('carries the conversation count it was given', () => {
    const row = buildAgentRow({ id: 1, name: 'Marisol' }, 121)
    assert.equal(row.id, '1')
    assert.equal(row.name, 'Marisol')
    assert.equal(row.conversations, 121)
  })

  it('leaves the period figures unset, for agentPeriodStats to fill in', () => {
    // Null, not zero: "nothing recorded" and "answered instantly" are different
    // answers, and the table shows a dash for one and a number for the other.
    const row = buildAgentRow({ id: 2, name: 'Marlowe' }, 0)
    assert.equal(row.avgReplySeconds, null)
    assert.equal(row.onlineSeconds, null)
  })
})

describe('the daily trend', () => {
  it('keeps one point per day, in the order given', () => {
    const trend = buildTrend([
      { day: '2026-09-14', conversations: 80 },
      { day: '2026-09-15', conversations: 67 },
    ])
    assert.deepEqual(trend, [
      { day: '2026-09-14', conversations: 80 },
      { day: '2026-09-15', conversations: 67 },
    ])
  })

  it('is empty when there are no conversations at all', () => {
    assert.deepEqual(buildTrend([]), [])
  })
})

describe('sorting the table', () => {
  const rows: AgentFunnelRow[] = [
    buildAgentRow({ id: 1, name: 'Marisol' }, 121),
    buildAgentRow({ id: 2, name: 'Katrina' }, 242),
    buildAgentRow({ id: 3, name: 'Marlowe' }, 2),
  ]

  it('puts the busiest agent first by default', () => {
    const sorted = sortAgents(rows, { key: FunnelSortKey.Conversations, dir: SortDir.Desc })
    assert.deepEqual(sorted.map((row) => row.name), ['Katrina', 'Marisol', 'Marlowe'])
  })

  it('puts agents with no figure last whichever way a period column is sorted', () => {
    const withStats = rows.map((row, index) => ({ ...row, avgReplySeconds: index === 1 ? null : (index + 1) * 60 }))
    const asc = sortAgents(withStats, { key: FunnelSortKey.ReplyTime, dir: SortDir.Asc }).map((row) => row.name)
    const desc = sortAgents(withStats, { key: FunnelSortKey.ReplyTime, dir: SortDir.Desc }).map((row) => row.name)
    assert.deepEqual(asc, ['Marisol', 'Marlowe', 'Katrina'])
    assert.deepEqual(desc, ['Marlowe', 'Marisol', 'Katrina'])
  })

  it('sorts by conversations, which is a different order entirely', () => {
    const sorted = sortAgents(rows, { key: FunnelSortKey.Conversations, dir: SortDir.Desc })
    assert.deepEqual(sorted.map((row) => row.name), ['Katrina', 'Marisol', 'Marlowe'])
  })

  it('sorts names as text, not as numbers', () => {
    const sorted = sortAgents(rows, { key: FunnelSortKey.Name, dir: SortDir.Asc })
    assert.deepEqual(sorted.map((row) => row.name), ['Katrina', 'Marisol', 'Marlowe'])
  })

  it('leaves the array it was given alone', () => {
    const before = rows.map((row) => row.name)
    sortAgents(rows, { key: FunnelSortKey.Conversations, dir: SortDir.Asc })
    assert.deepEqual(rows.map((row) => row.name), before)
  })
})
