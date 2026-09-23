import 'server-only'

// types
import type { ChatwootAgent, ChatwootInbox, ChatwootSummary, DailyConversations, FilterClause } from '@/types/chatwoot'

// lib
import { parseReplySeries, type DailyReplyTime } from './agent-days'
import { BUSINESS_UTC_OFFSET_HOURS, dayOf } from './business-time'
import { remember } from './memo'
import { getChatwootSettings } from './settings'

// Chatwoot has been measured at 6-8 seconds for a conversation-count query.
// The ceiling sits above that so the first read never times out before
// anything is cached. It is a backstop against a hung connection, not a
// latency budget — the memo in front of these calls is that.
const TIMEOUT_MS = 20_000

/**
 * Credentials come from bridge.chatwoot_settings on every call, since the
 * settings screen can change them while the panel is running. `{account}` in
 * the path is replaced with the account id here.
 */
async function chatwoot<T>(path: string, init: RequestInit = {}): Promise<T> {
  const settings = await getChatwootSettings()
  if (!settings) {
    throw new Error('Chatwoot is not configured — set the account on the Settings screen')
  }

  const response = await fetch(
    `${settings.baseUrl}${path.replace('{account}', settings.accountId)}`,
    {
      ...init,
      headers: {
        api_access_token: settings.apiToken,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    },
  )
  // Read as text first: a DELETE answers with an empty body, which is success,
  // not a JSON error.
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Chatwoot returned ${response.status} for ${path}${reasonFrom(text)}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

/**
 * Chatwoot's own words for a refusal, when it gives any — "401" alone does
 * not say the token belongs to an agent rather than an administrator.
 */
function reasonFrom(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown }
    const reason = parsed.message ?? parsed.error
    return typeof reason === 'string' && reason ? ` — ${reason}` : ''
  } catch {
    return ''
  }
}

/**
 * How two inbox names are compared for "already taken". Chatwoot allows any
 * number of inboxes with the same name, and "Sales-1" next to "sales-1 " is
 * as confusing as an exact repeat.
 */
export function inboxNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * A new API-channel inbox — the only kind the bridge can deliver into. Returns
 * its id; the reply webhook is set separately, when the inbox is attached to
 * a line. Needs an administrator's token — Chatwoot refuses this to agents.
 */
export async function createApiInbox(name: string): Promise<number> {
  const raw = await chatwoot<{ id?: number }>(`/api/v1/accounts/{account}/inboxes`, {
    method: 'POST',
    body: JSON.stringify({ name, channel: { type: 'api' } }),
  })
  if (typeof raw?.id !== 'number') {
    throw new Error(`Chatwoot answered without an inbox id — check its inbox list for "${name}"`)
  }
  return raw.id
}

/**
 * Put agents on an inbox. An agent only sees inboxes they are a member of in
 * Chatwoot, so a new inbox with no members is one the team cannot open.
 */
export async function addInboxMembers(inboxId: number, agentIds: number[]): Promise<void> {
  await chatwoot(`/api/v1/accounts/{account}/inbox_members`, {
    method: 'POST',
    body: JSON.stringify({ inbox_id: inboxId, user_ids: agentIds }),
  })
}

/**
 * Deleting an inbox deletes its conversations with it. The only caller removes
 * an inbox created moments earlier that failed to attach — nothing else in
 * the panel should reach for this.
 */
export async function deleteInbox(inboxId: number): Promise<void> {
  await chatwoot(`/api/v1/accounts/{account}/inboxes/${inboxId}`, { method: 'DELETE' })
}

/**
 * Conversation and message volume for the account, from Chatwoot rather than
 * us: we hold identifiers only, so we can count what passed through the
 * bridge but not what an agent did afterwards.
 */
export async function summary(days = 14): Promise<ChatwootSummary> {
  const until = Math.floor(Date.now() / 1000)
  const since = until - days * 24 * 60 * 60
  const raw = await chatwoot<{
    conversations_count?: number
    incoming_messages_count?: number
    outgoing_messages_count?: number
    avg_first_response_time?: number | string
    resolutions_count?: number
  }>(
    `/api/v2/accounts/{account}/reports/summary` +
      `?metric=conversations_count&type=account&since=${since}&until=${until}`,
  )

  const avg = Number(raw.avg_first_response_time)
  return {
    conversations: raw.conversations_count ?? 0,
    incomingMessages: raw.incoming_messages_count ?? 0,
    outgoingMessages: raw.outgoing_messages_count ?? 0,
    avgFirstResponseSeconds: Number.isFinite(avg) && avg > 0 ? avg : null,
    resolutions: raw.resolutions_count ?? 0,
  }
}

/** Open/assigned/unassigned counts for one inbox, which is one WhatsApp line. */
export async function inboxCounts(inboxId: number): Promise<{ total: number; unassigned: number }> {
  // The slowest figure on the card by an order of magnitude. Half a minute
  // fresh, then served from the previous reading while a new one fetches
  // behind it, so the count is never more than a minute old.
  const { value } = await remember(`chatwoot:inbox:${inboxId}`, () => readInboxCounts(inboxId), {
    ttlMs: 30_000,
    swrMs: 10 * 60_000,
    staleMs: 10 * 60_000,
  })
  return value
}

async function readInboxCounts(inboxId: number): Promise<{ total: number; unassigned: number }> {
  const raw = await chatwoot<{ meta?: { all_count?: number; unassigned_count?: number } }>(
    `/api/v1/accounts/{account}/conversations/meta?inbox_id=${inboxId}&status=all`,
  )
  return {
    total: raw.meta?.all_count ?? 0,
    unassigned: raw.meta?.unassigned_count ?? 0,
  }
}

/**
 * Point an API-channel inbox's webhook at the bridge, so agent replies leave
 * Chatwoot at all. Called from the assign-inbox action, not left as a manual
 * paste: the first real inbox once went out with this field empty, and agent
 * replies silently went nowhere with no error shown.
 */
export async function setInboxWebhook(inboxId: number, webhookUrl: string): Promise<void> {
  await chatwoot(`/api/v1/accounts/{account}/inboxes/${inboxId}`, {
    method: 'PATCH',
    body: JSON.stringify({ channel: { webhook_url: webhookUrl } }),
  })
}

// Re-exported: the settings components import their own
// copy of the availability picker's agent shape from here.
export type { ChatwootAgent } from '@/types/chatwoot'

/**
 * Every agent on the account. Read from Chatwoot
 * rather than kept as a roster of our own, so an add, remove or rename there
 * is right here on the next page load.
 */
/** Anything Chatwoot reports that we do not recognise reads as unknown, never as online. */
function availability(status: string | undefined): ChatwootAgent['availability'] {
  return status === 'online' || status === 'busy' || status === 'offline' ? status : 'unknown'
}

export async function listAgents(): Promise<ChatwootAgent[]> {
  // The roster changes when someone is hired, not when someone clicks "7 days".
  // A minute in memory is what makes a Funnel filter switch instant.
  const { value } = await remember('chatwoot:agents', readAgents, {
    ttlMs: 60_000,
    swrMs: 10 * 60_000,
    staleMs: 10 * 60_000,
  })
  return value
}

async function readAgents(): Promise<ChatwootAgent[]> {
  const raw = await chatwoot<
    { id?: number; name?: string; email?: string; availability_status?: string }[]
  >(`/api/v1/accounts/{account}/agents`)

  return (raw ?? [])
    .filter((agent): agent is { id: number; name?: string; email?: string; availability_status?: string } =>
      typeof agent.id === 'number',
    )
    .map((agent) => ({
      id: agent.id,
      name: agent.name ?? agent.email ?? `Agent ${agent.id}`,
      email: agent.email ?? '',
      availability: availability(agent.availability_status),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Every inbox in the account, for the assign-inbox picker. */
export async function listInboxes(): Promise<ChatwootInbox[]> {
  const raw = await chatwoot<{
    payload?: { id?: number; name?: string; channel_type?: string }[]
  }>(`/api/v1/accounts/{account}/inboxes`)

  return (raw.payload ?? [])
    .filter((inbox): inbox is { id: number; name?: string; channel_type?: string } =>
      typeof inbox.id === 'number',
    )
    .map((inbox) => ({
      id: inbox.id,
      name: inbox.name ?? `Inbox ${inbox.id}`,
      channelType: inbox.channel_type ?? 'unknown',
    }))
}

/**
 * How many conversations were opened for one agent between two dates. Read
 * from the filter endpoint's `all_count` metadata, not the rows — one call
 * instead of paging through twenty-five-per-page bodies. Matched on
 * `assignee_id`, not the cheaper whole-team agent report, because two of this
 * account's display names carry a trailing space. `created_at` bounds both
 * ends so the figure lines up with the range the screen asked for.
 */
export async function agentConversationCount(
  agentId: number,
  from: Date,
  to: Date,
  inboxId?: number,
): Promise<number> {
  // The inbox is part of the key. Without it the all-lines count and a single
  // line's count would share one memo entry, and whichever was asked for first
  // would be served to the other for the next minute.
  const key = `chatwoot:agent-convs:${agentId}:${from.getTime()}:${to.getTime()}:${inboxId ?? 'all'}`
  const { value } = await remember(key, () => readAgentConversationCount(agentId, from, to, inboxId), {
    ttlMs: 60_000,
    swrMs: 10 * 60_000,
    staleMs: 30 * 60_000,
  })
  return value
}

/**
 * One page of Chatwoot's conversation filter, and how many rows the whole
 * filter matches. Twenty-five conversations sorted by `last_activity_at`,
 * newest first, plus `meta.all_count`. lib/sync.ts walks these pages to build
 * the Funnel's copy. Filter values are dates, not times — unix seconds are
 * refused — and `is_greater_than <date>` means "after that whole day ended",
 * see `dayBefore` below.
 */
export async function filterConversations(
  clauses: FilterClause[],
  page: number,
  signal?: AbortSignal,
): Promise<{ allCount: number; payload: unknown[] }> {
  // Every clause but the last carries `query_operator: 'and'`; the last carries
  // null. Built as a list so adding a clause cannot leave that dangling.
  const raw = await chatwoot<{ meta?: { all_count?: number }; payload?: unknown[] }>(
    `/api/v1/accounts/{account}/conversations/filter?page=${page}`,
    {
      method: 'POST',
      body: JSON.stringify({
        payload: clauses.map((clause, index) => ({
          ...clause,
          query_operator: index === clauses.length - 1 ? null : 'and',
        })),
      }),
      signal,
    },
  )
  return { allCount: raw.meta?.all_count ?? 0, payload: raw.payload ?? [] }
}

async function readAgentConversationCount(
  agentId: number,
  from: Date,
  to: Date,
  inboxId?: number,
): Promise<number> {
  const clauses: FilterClause[] = [
    { attribute_key: 'assignee_id', filter_operator: 'equal_to', values: [agentId] },
    {
      attribute_key: 'created_at',
      filter_operator: 'is_greater_than',
      values: [isoDate(dayBefore(from))],
    },
    { attribute_key: 'created_at', filter_operator: 'is_less_than', values: [isoDate(to)] },
  ]
  if (inboxId !== undefined) {
    clauses.push({ attribute_key: 'inbox_id', filter_operator: 'equal_to', values: [inboxId] })
  }

  const { allCount } = await filterConversations(clauses, 1)
  return allCount
}

/**
 * Chatwoot's filter API wants a plain date on its own (UTC) clock. The Costa
 * Rica day handed over is the nearest whole day, and can sit up to six hours
 * off the actual business midnight — lib/mirror.ts counts on exact instants
 * instead, one more reason it is the destination and this is not.
 */
function isoDate(at: Date): string {
  return dayOf(at)
}

/**
 * Chatwoot reads `is_greater_than <date>` as "after that whole day ended", so
 * asking for the range's first day silently drops it — measured as
 * `> 2026-09-03` returning 1,016 conversations against 979 for `> 2026-09-04`,
 * the missing 37 being 4 September itself. It cost one agent their entire
 * conversation count the first time round. `is_less_than` needs no such
 * treatment — the upper bound is already exclusive.
 */
function dayBefore(at: Date): Date {
  return new Date(at.getTime() - 86_400_000)
}

/**
 * Conversations opened per day across the whole account — the endpoint behind
 * Chatwoot's own reports page. Cannot be built by summing the per-agent counts
 * above: an unassigned conversation belongs to no agent but still counts here.
 */
export async function dailyConversations(
  from: Date,
  to: Date,
  inboxId?: number,
): Promise<DailyConversations[]> {
  const key = `chatwoot:daily-convs:${from.getTime()}:${to.getTime()}:${inboxId ?? 'all'}`
  const { value } = await remember(key, () => readDailyConversations(from, to, inboxId), {
    ttlMs: 60_000,
    swrMs: 10 * 60_000,
    staleMs: 30 * 60_000,
  })
  return value
}

async function readDailyConversations(
  from: Date,
  to: Date,
  inboxId?: number,
): Promise<DailyConversations[]> {
  const since = Math.floor(from.getTime() / 1000)
  const until = Math.floor(to.getTime() / 1000)
  // `type=inbox` needs the inbox in `id`; account-wide takes no id.
  const scope =
    inboxId === undefined ? 'type=account' : `type=inbox&id=${encodeURIComponent(String(inboxId))}`
  // `timezone_offset` cuts days at business midnight, so `dayOf` names the
  // right day. Checked on 18 Sep 2026: no partial day at either end.
  const raw = await chatwoot<{ value?: number; timestamp?: number }[]>(
    `/api/v2/accounts/{account}/reports` +
      `?metric=conversations_count&${scope}&since=${since}&until=${until}` +
      `&timezone_offset=${BUSINESS_UTC_OFFSET_HOURS}`,
  )

  return (raw ?? [])
    .filter((point): point is { value?: number; timestamp: number } =>
      typeof point.timestamp === 'number',
    )
    .map((point) => ({
      day: dayOf(new Date(point.timestamp * 1000)),
      conversations: Number(point.value) || 0,
    }))
}

/**
 * Chatwoot's name for the metric behind the "Reply time" column of its own
 * Reports → Agents page — every agent reply's time since the message it
 * answered, averaged. Verified against this account on 17 Sep 2026.
 */
const REPLY_METRIC = 'reply_time'

/**
 * One agent's average reply time per day. Memoised like the daily conversation
 * count above; ten agents means ten of these per render, fine at this size.
 */
export async function dailyReplyTime(agentId: number, from: Date, to: Date): Promise<DailyReplyTime[]> {
  const key = `chatwoot:reply-time:${agentId}:${from.getTime()}:${to.getTime()}`
  const { value } = await remember(key, () => readDailyReplyTime(agentId, from, to), {
    ttlMs: 60_000,
    swrMs: 10 * 60_000,
    staleMs: 30 * 60_000,
  })
  return value
}

async function readDailyReplyTime(agentId: number, from: Date, to: Date): Promise<DailyReplyTime[]> {
  const since = Math.floor(from.getTime() / 1000)
  const until = Math.floor(to.getTime() / 1000)
  // `type=agent` takes the numeric id, not the display name the CSV report
  // keys on (two agents here carry a trailing space in it). `type=agent`
  // cannot combine with an inbox, so the Funnel's line filter skips this table.
  const raw = await chatwoot<unknown>(
    `/api/v2/accounts/{account}/reports` +
      `?metric=${REPLY_METRIC}&type=agent&id=${encodeURIComponent(String(agentId))}&since=${since}&until=${until}` +
      `&timezone_offset=${BUSINESS_UTC_OFFSET_HOURS}`,
  )
  return parseReplySeries(raw, from, to)
}
