import 'server-only'

// types
import type { PresenceInterval } from '@/types/agent-days'

// lib
import { isUndefinedTable, query } from './db'

// The bridge's record of each agent's availability, for the Funnel's Online-time
// table. Written by services/bridge/src/routing/presence.ts once a minute; the
// arithmetic over it lives in agent-days.ts, where it can be tested.
// Not memoised, same reason as mirror.ts: the range scan answers in milliseconds.

/** The table is not there: the bridge has not been deployed with it yet. */
export class PresenceUnavailable extends Error {
  constructor() {
    super('The presence record has not been created yet — the bridge needs a deploy')
    this.name = 'PresenceUnavailable'
  }
}

async function read<T>(text: string, values: unknown[] = []): Promise<T[]> {
  try {
    return await query<T>(text, values)
  } catch (error) {
    if (isUndefinedTable(error)) throw new PresenceUnavailable()
    throw error
  }
}

/** Every stretch that overlaps [from, to), whichever status it was. */
export async function presenceIntervals(from: Date, to: Date): Promise<PresenceInterval[]> {
  return read<PresenceInterval>(
    `select chatwoot_agent_id as "agentId", status, since_at as "sinceAt", seen_at as "seenAt"
       from bridge.agent_presence
      where seen_at >= $1 and since_at < $2
      order by since_at`,
    [from, to],
  )
}

/** When the record begins, or null while it is empty. */
export async function presenceRecordedSince(): Promise<Date | null> {
  const rows = await read<{ since: Date | null }>(`select min(since_at) as "since" from bridge.agent_presence`)
  return rows[0]?.since ?? null
}
