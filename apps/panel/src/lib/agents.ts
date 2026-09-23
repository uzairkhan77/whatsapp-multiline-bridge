import 'server-only'

// types
import type { ChatwootAgent } from '@/types/chatwoot'
import type { Roster } from '@/types/agents'

// lib
import { listAgents } from './chatwoot'
import { isUndefinedTable, query } from './db'

// The Chatwoot agent roster, cached in bridge.chatwoot_agents so display names
// do not wait on Chatwoot on every page load. Chatwoot stays the roster for
// this cache is only ever for display names, never for a decision.

/**
 * How long a cached roster is used without checking Chatwoot again. Long,
 * deliberately: agents are added a few times a year, so five minutes stale
 * costs nothing next to the cost of a slow page.
 */
const TTL_MS = 5 * 60 * 1000

interface CacheRow {
  id: number
  name: string
  email: string | null
  availability: string
  syncedAt: Date
}

function shape(agents: ChatwootAgent[]): Roster {
  return {
    agents,
    byEmail: new Map(agents.filter((a) => a.email).map((a) => [a.email.toLowerCase(), a.name])),
    byId: new Map(agents.map((a) => [a.id, a.name])),
    empty: agents.length === 0,
  }
}

async function readCache(): Promise<{ agents: ChatwootAgent[]; syncedAt: number } | null> {
  try {
    const rows = await query<CacheRow>(
      `select id, name, email, availability, synced_at as "syncedAt"
         from bridge.chatwoot_agents
        order by name`,
    )
    if (rows.length === 0) return null
    return {
      agents: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email ?? '',
        availability: availability(row.availability),
      })),
      // The oldest row, so one stale entry refreshes the whole roster.
      syncedAt: Math.min(...rows.map((row) => new Date(row.syncedAt).getTime())),
    }
  } catch (error) {
    // A missing table means the bridge has not deployed the schema yet — a
    // cold cache, not a failure. Fall through to Chatwoot.
    if (isUndefinedTable(error)) return null
    throw error
  }
}

function availability(status: string): ChatwootAgent['availability'] {
  return status === 'online' || status === 'busy' || status === 'offline' ? status : 'unknown'
}

/**
 * Replace the cached roster with what Chatwoot just said: upsert plus a delete
 * of everything absent, so a removed agent leaves here too. Never throws — a
 * failed cache write is not a reason to fail the page.
 */
async function writeCache(agents: ChatwootAgent[]): Promise<void> {
  if (agents.length === 0) return
  try {
    await query(
      `insert into bridge.chatwoot_agents (id, name, email, availability, synced_at)
       select id, name, email, availability, now()
         from unnest($1::int[], $2::text[], $3::text[], $4::text[])
                as t(id, name, email, availability)
       on conflict (id) do update
          set name         = excluded.name,
              email        = excluded.email,
              availability = excluded.availability,
              synced_at    = excluded.synced_at`,
      [
        agents.map((a) => a.id),
        agents.map((a) => a.name),
        agents.map((a) => a.email || null),
        agents.map((a) => a.availability),
      ],
    )
    await query(`delete from bridge.chatwoot_agents where not (id = any($1::int[]))`, [
      agents.map((a) => a.id),
    ])
  } catch {
    // Including the missing table. The caller already has the live roster.
  }
}

/** The roster: cached when recent, refreshed when not, cached again if the refresh fails. */
export async function agentRoster(): Promise<Roster> {
  const cached = await readCache().catch(() => null)

  if (cached && Date.now() - cached.syncedAt < TTL_MS) return shape(cached.agents)

  try {
    const live = await listAgents()
    // An empty answer is treated as unusable: a misconfigured account and one
    // with no agents look identical, and blanking a roster we hold is worse.
    if (live.length === 0 && cached) return shape(cached.agents)
    await writeCache(live)
    return shape(live)
  } catch {
    return shape(cached?.agents ?? [])
  }
}
