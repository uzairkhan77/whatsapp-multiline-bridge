// The two duration formats: one for time waited, one for time spent.
//
// Run with: pnpm --filter @multiline/panel test

// node
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// lib
import { duration, hoursMinutes, periodLabel } from './format'

describe('time spent, as hours and minutes', () => {
  it('reads as minutes under an hour and as hours past it', () => {
    assert.equal(hoursMinutes(0), '0m')
    assert.equal(hoursMinutes(45 * 60), '45m')
    assert.equal(hoursMinutes(6 * 3600), '6h')
    assert.equal(hoursMinutes(6 * 3600 + 20 * 60), '6h 20m')
  })

  it('rounds to the nearest minute, and carries into the hour', () => {
    assert.equal(hoursMinutes(29), '0m')
    assert.equal(hoursMinutes(31), '1m')
    assert.equal(hoursMinutes(59 * 60 + 40), '1h')
  })

  it('is a dash for nothing', () => {
    assert.equal(hoursMinutes(null), '—')
  })
})

describe('time waited, at a glance', () => {
  it('picks the coarsest unit that is still true', () => {
    assert.equal(duration(45), '45s')
    assert.equal(duration(12 * 60), '12m')
    assert.equal(duration(78 * 60), '1.3h')
    assert.equal(duration(null), '—')
  })
})

describe('a span of days, as written', () => {
  it('joins two days in one month with a dash', () => {
    assert.equal(periodLabel('2026-09-11', '2026-09-17'), 'Sep 11–17')
  })

  it('names both months when the span crosses one', () => {
    assert.equal(periodLabel('2026-08-28', '2026-09-03'), 'Aug 28 – Sep 3')
  })

  it('names both years when the span crosses one', () => {
    assert.equal(periodLabel('2025-12-30', '2026-01-02'), 'Dec 30, 2025 – Jan 2, 2026')
  })

  it('is one date for one day', () => {
    assert.equal(periodLabel('2026-09-17', '2026-09-17'), 'Sep 17')
  })
})
