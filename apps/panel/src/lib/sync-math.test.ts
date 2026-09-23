// node
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// enums
import { RunPlan, SyncSource } from '@/enums/sync'

// lib
import {
  ERROR_BACKOFF_MS,
  RUN_FLOOR_MS,
  filterDayFor,
  isLastPage,
  pageIsPastWatermark,
  pagesFor,
  planRun,
  stopBefore,
  toMirrorConversation,
  type SyncStateRow,
} from './sync-math'


function state(overrides: Partial<SyncStateRow> = {}): SyncStateRow {
  return {
    source: SyncSource.Conversations,
    watermarkAt: new Date('2026-09-16T10:00:00Z'),
    walkPage: null,
    walkStartedAt: null,
    walkSince: null,
    sourceTotal: 1148,
    leaseToken: null,
    leaseUntil: null,
    lastRunAt: null,
    lastOkAt: new Date('2026-09-16T10:00:05Z'),
    lastRows: 22,
    lastError: null,
    ...overrides,
  }
}

describe('which day to ask Chatwoot for', () => {
  it('steps back the margin plus the day Chatwoot drops', () => {
    // The lost-first-day case: a range starting 4 September needs `> 3 September`;
    // with two days of margin the ask becomes `> 1 September`.
    assert.equal(filterDayFor(new Date('2026-09-04T09:30:00Z')), '2026-09-01')
    assert.equal(filterDayFor(new Date('2026-09-04T09:30:00Z'), 0), '2026-09-03')
  })

  it('is a UTC day whatever the hour', () => {
    assert.equal(filterDayFor(new Date('2026-09-16T23:59:59Z'), 1), '2026-09-14')
    assert.equal(filterDayFor(new Date('2026-09-17T00:00:01Z'), 1), '2026-09-15')
  })
})

describe('where a walk stops', () => {
  const watermark = new Date('2026-09-16T10:00:00Z')
  const stopAt = stopBefore(watermark)

  it('overlaps the previous run by a few minutes', () => {
    assert.equal(stopAt.getTime(), watermark.getTime() - 10 * 60_000)
  })

  it('stops on a page whose oldest row is older than the stop', () => {
    const page = [
      { lastActivityAt: new Date('2026-09-16T12:00:00Z') },
      { lastActivityAt: new Date('2026-09-16T09:00:00Z') },
    ]
    assert.equal(pageIsPastWatermark(page, stopAt), true)
  })

  it('keeps going while every row on the page is newer', () => {
    const page = [
      { lastActivityAt: new Date('2026-09-16T12:00:00Z') },
      { lastActivityAt: new Date('2026-09-16T09:55:00Z') },
    ]
    assert.equal(pageIsPastWatermark(page, stopAt), false)
  })

  it('treats an empty page as past and an unstamped row as unknown', () => {
    assert.equal(pageIsPastWatermark([], stopAt), true)
    assert.equal(pageIsPastWatermark([{ lastActivityAt: null }], stopAt), false)
  })
})

describe('the last page', () => {
  it('is any short page', () => {
    assert.equal(isLastPage(46, 23, 1148), true)
    assert.equal(isLastPage(3, 0, 1148), true)
  })

  it('is a full page only when the count says nothing follows', () => {
    assert.equal(isLastPage(1, 25, 26), false)
    assert.equal(isLastPage(2, 25, 50), true)
    // The count shrank below the pages already read: something was deleted.
    assert.equal(isLastPage(5, 25, 100), true)
  })

  it('counts pages', () => {
    assert.equal(pagesFor(1148), 46)
    assert.equal(pagesFor(0), 1)
    assert.equal(pagesFor(25), 1)
  })
})

describe('whether a refresh syncs at all', () => {
  const now = new Date('2026-09-16T10:05:00Z')

  it('skips inside the floor of the last attempt', () => {
    assert.equal(planRun(state({ lastRunAt: new Date(now.getTime() - RUN_FLOOR_MS + 1) }), now), RunPlan.Skip)
    assert.equal(planRun(state({ lastRunAt: new Date(now.getTime() - RUN_FLOOR_MS - 1) }), now), RunPlan.Run)
  })

  it('backs off longer after a failure', () => {
    const failed = state({ lastRunAt: new Date(now.getTime() - 60_000), lastError: 'Chatwoot returned 502' })
    assert.equal(planRun(failed, now), RunPlan.Skip)
    assert.equal(planRun({ ...failed, lastRunAt: new Date(now.getTime() - ERROR_BACKOFF_MS - 1) }, now), RunPlan.Run)
  })

  it('lets a person override both', () => {
    assert.equal(planRun(state({ lastRunAt: now, lastError: 'x' }), now, true), RunPlan.Run)
  })

  it('walks when a walk is saved or nothing has ever completed', () => {
    assert.equal(planRun(state({ walkPage: 17 }), now), RunPlan.Walk)
    assert.equal(planRun(state({ watermarkAt: null, lastOkAt: null }), now), RunPlan.Walk)
  })

  it('does nothing without a state row', () => {
    assert.equal(planRun(undefined, now), RunPlan.Skip)
  })
})

describe('reading a conversation off the wire', () => {
  const raw = {
    id: 1154,
    inbox_id: 135495,
    status: 'open',
    created_at: 1789542886,
    last_activity_at: 1789542937,
    meta: { assignee: { id: 269807, email: ' RosalindA@example.net ', name: 'Rosalind Ayala' } },
  }

  it('keeps the fields the copy needs, as dates and lower-cased', () => {
    const row = toMirrorConversation(raw)
    assert.ok(row)
    assert.equal(row.id, 1154)
    assert.equal(row.inboxId, 135495)
    assert.equal(row.status, 'open')
    assert.equal(row.createdAt.toISOString(), '2026-09-16T07:14:46.000Z')
    assert.equal(row.lastActivityAt?.toISOString(), '2026-09-16T07:15:37.000Z')
    assert.equal(row.assigneeId, 269807)
    assert.equal(row.assigneeEmail, 'rosalinda@example.net')
  })

  it('reads an unassigned conversation and a missing meta', () => {
    assert.equal(toMirrorConversation({ ...raw, meta: { assignee: null } })?.assigneeId, null)
    assert.equal(toMirrorConversation({ ...raw, meta: undefined })?.assigneeEmail, null)
  })

  it('refuses anything without an id or a creation time', () => {
    assert.equal(toMirrorConversation({ ...raw, id: '1154' }), null)
    assert.equal(toMirrorConversation({ ...raw, created_at: undefined }), null)
    assert.equal(toMirrorConversation(null), null)
    assert.equal(toMirrorConversation('x'), null)
  })
})
