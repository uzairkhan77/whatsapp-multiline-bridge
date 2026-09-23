# Agent availability

Conversations are assigned by Chatwoot's own rules — the bridge does not route
them. What it does is keep Chatwoot's picture of who is available honest, and
keep a record of it that Chatwoot itself does not keep.

Two things live here:

1. **Setting inactive agents Offline**, so somebody who has gone home stops
   collecting customers.
2. **Recording who was Online, and for how long**, so the Funnel can report it.

Both run on one fifteen-minute pass, reading Chatwoot's agent list once.

## Setting inactive agents Offline

An agent who closes their laptop without changing their status keeps collecting
customers all evening. Chatwoot's own auto-offline does not catch it — see the
note at the bottom about why that setting is deliberately off here.

An agent is set Offline when **all three** are true:

- They are **Online or Busy**. Both still receive new conversations, so both are
  worth taking out. Someone already Offline is left alone.
- They have **sent nothing at all** for longer than the limit — no reply to a
  customer, no private note to a colleague.
- **A customer assigned to them has been waiting** longer than the limit for a
  reply.

All three together, because any one of them alone removes the wrong person. Idle
on its own would take out an agent who had a quiet half hour with nobody waiting.
A waiting customer on its own would take out an agent who is working flat out and
is merely behind on one conversation.

Going Offline is the **only** change. Conversations already assigned stay with
them, and nobody is signed out of Chatwoot. An agent can set themselves back
Online whenever they like — and if they are still away, the rule catches them
again on a later pass.

Every change is written to `bridge.agent_offline_events` — which agent, when,
which conversation was waiting and for how long — and the most recent ones are
shown on the settings screen.

Every change is also **emailed to the agent**, at the address on their Chatwoot
account, and to nobody else — the notification addresses (Settings →
Notifications) are not copied. The email names the limit and the conversation
that had waited longest, and says that no new customers arrive while they are
Offline; it asks nothing of them. Times are given in the business timezone with
the UTC stamp beside them. It goes out after the change is made and recorded; if
it cannot be sent — no `RESEND_API_KEY`, no way to reach Resend — the change
still stands, and the bridge logs a warning saying why. An account with no email
falls back to the notification addresses.

Two things to know about the measurements:

- **"A customer is waiting" is Chatwoot's own `waiting_since`.** It starts when a
  customer's message arrives with no reply outstanding, and clears the instant a
  person sends a non-private reply or resolves the conversation. Reading theirs
  rather than keeping our own version means it is right by definition.
- **"The agent has sent nothing" is ours**, recorded in `bridge.agent_activity`
  from the Chatwoot webhook the bridge already receives for every outgoing
  message. An agent we have never seen speak counts as idle — on a fresh
  deployment that means the rule falls back to the waiting-customer condition
  alone, rather than never firing.

An agent is set Offline at the first pass after both the silence and the wait
pass the limit — with the default of 30 minutes, somewhere between 30 and 45
minutes after they stop. The first pass after the bridge restarts comes fifteen
minutes in.

## Settings

**Settings → Availability**, on the Operator Console:

| Setting | Default | What it does |
|---|---|---|
| Set inactive agents Offline automatically | Off | The master switch. Off by default because it changes a person's own account — somebody should decide to turn it on. |
| Limit | 30 minutes | How long both the silence and the customer's wait must run. 1 to 1440. |

Saved changes are live within 30 seconds. No restart, no redeploy.

## Recording who is Online

Chatwoot only ever says what an agent's status is *now*. The Funnel wants to say
how long each agent was Online on each day, so on the same fifteen-minute pass
the bridge writes what it read to `bridge.agent_presence`: one row per unbroken
stretch of one status, its `seen_at` moved forward while the status holds and a
new row opened when it changes. Every status is recorded, Offline included.

Two things follow from how it is taken:

- **A gap is a gap.** If the bridge was down, or Chatwoot did not answer, for
  longer than twenty minutes, the stretch is closed and a new one starts when the
  looking resumes. Time nobody watched is never counted as Online — and never as
  Offline either. On the Funnel such a day shows "—" rather than "0m".
- **Online means the status, not the desk.** The figure is how long the status
  *said* Online. It is only as truthful as the team's habit of setting themselves
  Offline, and the rule above being switched on. The screen says so.

The resolution is fifteen minutes: a status change reaches the record up to
fifteen minutes after it happened, the whole gap between two looks counts as the
status seen at the first, and a change that reverts inside one gap is not seen at
all. The record starts on the day the bridge was first deployed — there is
nothing to backfill from.

## Why Chatwoot's own auto-offline is turned off

A common Chatwoot setup has every agent's `auto_offline` turned off and their
availability set to Online, so Chatwoot counts them as online whether or not the
dashboard is open. It is what stops an agent dropping out of Chatwoot's own
routing the moment they close a tab.

The cost is that Chatwoot's presence dot stops telling anyone who is actually at
their desk. The rule above is the answer to it: rather than reading a presence
flag that configuration has made meaningless, it watches what an agent actually
does — whether they have said anything, and whether a customer of theirs is
waiting.

## Where the code is

| | |
|---|---|
| The rule | `services/bridge/src/routing/auto-offline.ts` — the decision is `agentsToTakeOffline`, which is pure and tested |
| Its tables | `bridge.auto_offline_settings`, `bridge.agent_activity`, `bridge.agent_offline_events` |
| Its screen | `apps/panel/src/components/settings/AutoOfflineForm.tsx` |
| The email | `agentTakenOffline` in `services/bridge/src/alerts/alert-templates.ts`; delivery in `clients/mailer.ts` |
| The presence record | `services/bridge/src/routing/presence.ts` — the decision is `planPresenceTick`, pure and tested; table `bridge.agent_presence` |
| The pass that runs both | `services/bridge/src/jobs/agent-pass.ts` |

## Not built yet

- **Per-agent limits.** Nothing caps how many open conversations one agent holds.
