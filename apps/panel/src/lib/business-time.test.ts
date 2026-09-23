// The fixed shift that makes a "day" mean a day in the business's own timezone,
// and the proof that the shift and the zone name agree with each other.
//
// Run with: pnpm --filter @multiline/panel test

// node
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// The module reads the environment once, when it is first imported, so the
// configuration has to be set before that happens — hence the dynamic import
// in `before` rather than a normal one at the top. Asia/Dubai is used because
// it is a whole number of hours ahead and never observes daylight saving,
// which is exactly what the module requires of a zone.
process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE = 'Asia/Dubai'
process.env.NEXT_PUBLIC_BUSINESS_UTC_OFFSET_HOURS = '4'
process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE_LABEL = 'Dubai time'

let tz: typeof import('./business-time')

before(async () => {
  tz = await import('./business-time')
})

describe('which day an instant falls on', () => {
  it('takes the configured zone, not the server clock', () => {
    assert.equal(tz.BUSINESS_TIMEZONE, 'Asia/Dubai')
    assert.equal(tz.BUSINESS_UTC_OFFSET_HOURS, 4)
    assert.equal(tz.BUSINESS_TIMEZONE_LABEL, 'Dubai time')
  })

  it('puts an early morning there on that day, not the UTC day before', () => {
    // 7am on 18 September in Dubai is 3am on the 18th in UTC — same day here,
    // but the shift is what decides it.
    assert.equal(tz.dayOf(new Date('2026-09-18T03:00:00Z')), '2026-09-18')
  })

  it('changes day at twenty hundred UTC', () => {
    assert.equal(tz.dayOf(new Date('2026-09-17T19:59:59Z')), '2026-09-17')
    assert.equal(tz.dayOf(new Date('2026-09-17T20:00:00Z')), '2026-09-18')
  })

  it('starts a day at twenty hundred UTC and ends it twenty-four hours later', () => {
    assert.equal(tz.startOfDay('2026-09-18').toISOString(), '2026-09-17T20:00:00.000Z')
    assert.equal(
      tz.startOfDayContaining(new Date('2026-09-18T03:00:00Z')).toISOString(),
      '2026-09-17T20:00:00.000Z',
    )
    assert.equal(
      new Date(tz.nextMidnight(Date.parse('2026-09-18T03:00:00Z'))).toISOString(),
      '2026-09-18T20:00:00.000Z',
    )
    assert.equal(
      tz.addDays(tz.startOfDay('2026-09-18'), 1).toISOString(),
      '2026-09-18T20:00:00.000Z',
    )
  })

  it('is exactly midnight after the start of a day, not the same instant', () => {
    const midnight = tz.startOfDay('2026-09-18').getTime()
    assert.equal(tz.nextMidnight(midnight), midnight + 86_400_000)
  })

  it('gives an invalid date for a string that is not one, rather than throwing', () => {
    assert.equal(Number.isFinite(tz.startOfDay('not-a-date').getTime()), false)
  })

  it('agrees with the zone data Node ships, all year round', () => {
    // The shift is a single constant, so it is only correct if the configured
    // zone never moves. Checking every month against Node's own zone data
    // catches both a wrong offset and a zone that observes daylight saving —
    // in which case the configuration, not this test, is what has to change.
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz.BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    for (const month of [1, 3, 6, 7, 10, 12]) {
      for (const hour of [0, 5, 6, 12, 19, 20, 23]) {
        const at = new Date(Date.UTC(2026, month - 1, 15, hour, 30))
        assert.equal(tz.dayOf(at), format.format(at), at.toISOString())
      }
    }
  })
})
