# The Funnel screen

How much each agent handled, how fast they answered, and how long they were
there. One screen, three sources, every figure counted over the same dates.

## Where each section comes from

| Section | Source | Filtered by line? |
|---|---|---|
| Summary tiles, trend chart, **By agent** table | Conversations from Chatwoot, or the copy in `bridge.conversations` — see `apps/panel/src/lib/funnel.ts` | Yes |
| **Avg response** and **Online time** columns of the By-agent table, and the **Response time** chart | Chatwoot's reports API, per agent: `metric=reply_time&type=agent&id=<agent>` | **No** |
| **Online time** column and chart | `bridge.agent_presence`, written by the bridge every fifteen minutes on the same pass as rule 7 — see `docs/03-availability.md`, "Recording who is Online" | **No** |

The line filter does not reach the last two, and the screen says so beside each
of them whenever a line is picked. Chatwoot's per-agent report cannot also be
scoped to an inbox, and an agent's status is not a property of any line.

## Days are business days

Every "day" on this screen runs midnight to midnight in the configured business
timezone, and so do the presets — Today, Yesterday, 7 days and the rest. The
screen says so under the trend chart and in the footer. It was UTC once, which
put an evening conversation on the next day and split an evening shift across
two rows.

The arithmetic is `apps/panel/src/lib/business-time.ts`, one fixed offset, and
everything that buckets by day goes through it:

| Where | How |
|---|---|
| The range — `resolveRange` in `funnel-math.ts` | business midnights as instants; every read counts between them |
| The copy — `mirror.ts` — and the dashboard's message volume in `db.ts` | `created_at at time zone <the configured zone>` |
| Chatwoot's reports — `chatwoot.ts` | `timezone_offset` set from the same configuration, so each point is a business midnight |
| The presence record — `agent-days.ts` | Stretches are cut at business midnight |

One read is only approximately right: the **live** per-agent conversation count
goes through Chatwoot's filter endpoint, which takes whole dates on Chatwoot's
own clock (UTC), so its boundary can sit a few hours off the business midnight. The copy counts on the exact instants. That is one more reason the
copy is the destination (`FUNNEL_SOURCE=mirror`).

## Response time

"Reply time" in Chatwoot's own words: for every reply an agent sends, the time
since the customer message it answered, averaged over the day. Not only the
first reply in a conversation — that is Chatwoot's `avg_first_response_time`, and
switching to it is a one-line change of the `REPLY_METRIC` constant in
`apps/panel/src/lib/chatwoot.ts`.

A day with no replies is a dash, not 0s: Chatwoot fills such a day with zero,
which as a reply time would read as "instant". A column of dashes with a warning
above the screen means Chatwoot could not be asked about that agent.

One report call per agent per render, memoised for a minute and served stale for
ten while a fresh one is fetched, like the other Chatwoot reads.

## Online time

How long the agent's Chatwoot status was **Online** that day, with Busy on a
second line. "—" means the bridge was not watching that agent that day; "0m" means
it was, and they were never Online. The footnote under the table says when the
record began. What the figure does and does not mean is spelled out in
`docs/03-availability.md` — in short, it is the status they set, not whether they
were at their desk.

## Where the code is

| | |
|---|---|
| Assembly | `apps/panel/src/lib/funnel.ts` — `loadFunnel`, `assembleAgentDays` |
| Arithmetic, tested | `apps/panel/src/lib/agent-days.ts` — `bucketPresence`, `parseReplySeries`, `replySeries`, `onlineSeries` |
| Chatwoot report | `apps/panel/src/lib/chatwoot.ts` — `dailyReplyTime` |
| Presence read | `apps/panel/src/lib/presence.ts` |
| Presence write | `services/bridge/src/routing/presence.ts` |
| The charts | `apps/panel/src/components/ReplyTimeChart.tsx` (a line per agent), `apps/panel/src/components/OnlineTimeChart.tsx` (a stacked bar per day), rendered from `apps/panel/src/app/(app)/funnel/page.tsx` |
