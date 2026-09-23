import 'server-only'

// types
import type { ConfiguredLine, LineArrival } from '@/types/lines'

// lib
import { query } from './db'
import { remember } from './memo'

/**
 * The routing table the bridge actually uses, read from the same rows it reads.
 * No fallback to a file: a panel that cannot reach the database should say so,
 * not answer from something read at build time.
 */
export async function configuredLines(): Promise<ConfiguredLine[]> {
  // Read fresh every time (ttl 0); on a failed read the last good table is used
  // for a few minutes rather than drawing every line as "not routed".
  const { value } = await remember('db:lines', readConfiguredLines, { ttlMs: 0, staleMs: 5 * 60_000 })
  return value
}

async function readConfiguredLines(): Promise<ConfiguredLine[]> {
  return query<ConfiguredLine>(`
    select instance,
           chatwoot_inbox_id as "chatwootInboxId",
           fallback_instance as "fallbackInstance",
           enabled
      from bridge.lines
     order by instance
  `)
}
