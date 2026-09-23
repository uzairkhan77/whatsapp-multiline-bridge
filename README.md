# WhatsApp multiline bridge

A solution for running several WhatsApp numbers through one shared team inbox.

A team with more than one WhatsApp number usually ends up with more than one
phone, and history that lives on whichever handset happened to take the message.
Nobody can see the whole picture, and there is no record of who answered what.
This closes that: every number lands in one Chatwoot inbox, replies go back out
over the number the customer wrote to, and the whole thread stays in one place.

Names, domains and infrastructure identifiers in this repository are fictional.
A personal project, shared as-is; not actively supported.

> **Note:** the gateway connects to WhatsApp as an unofficial WhatsApp Web
> client, not through the official WhatsApp Business API. That is against
> WhatsApp's terms of service and can get the connected numbers banned. Use it
> at your own risk.

```
                  ┌───────────────┐        ┌───────────────┐
  WhatsApp ──────▶│   Evolution   │───────▶│    bridge     │──────▶ Chatwoot
  (many numbers)  │   (gateway)   │◀───────│  (this repo)  │◀────── (agents reply)
                  └───────────────┘        └───────┬───────┘
                                                   │
                                            Postgres
                                                   │
                                          ┌────────┴─────────┐
                                          │ operator console │
                                          └──────────────────┘
```

Chatwoot is the system of record for conversation content, and assigns
conversations with its own rules — the bridge never mirrors messages into its
own store and never routes them. It keeps only what Chatwoot cannot answer:
which number carried a message, and who was online when.

## What it does

**Carries messages both ways, with the awkward parts handled.** Photos, video,
documents, stickers and captions. Voice notes are transcoded to MP3 when the
original would not play on every device. Shared contacts arrive as a readable
list *and* a `.vcf`; shared locations as a named place with a link. A file too
large to carry becomes a line of text naming the file and its size, so an agent
knows to ask for it another way rather than seeing nothing at all.

**Deletes and edits follow the message.** An agent deleting a message in Chatwoot
revokes it on WhatsApp too; a customer deleting one on WhatsApp has it removed in
Chatwoot. A customer's edit arrives as a labelled follow-up, since Chatwoot has
no in-place edit of its own.

**Fails over between numbers.** Each line can nominate a fallback. If the primary
is down the reply goes out on the fallback, the conversation stays a single
thread, and the ledger records which number actually carried it.

**Manages the lines.** Connection state, QR pairing, reconnect and delete from
the console, plus five carefully de-duplicated alert emails. A gateway emits
bursts of close/connecting/open during an ordinary reconnect, so the alerting
holds a grace period and one real outage produces one email rather than six.

**Keeps availability honest.** An agent who closes their laptop without changing
their status keeps collecting customers all evening, so a fifteen-minute pass
sets genuinely inactive agents Offline — judged on whether they have said
anything *and* whether a customer of theirs is waiting, never one alone. The same
pass records who was Online, which Chatwoot itself never keeps.

**Reports.** Conversation volume by line and by agent, reply times, and Online
time per agent per day.

## The parts worth reading

Things here that were more interesting to solve than they look:

**Idempotency is an insert, not a read.** Both directions claim a message by
inserting into `bridge.message_map`; a webhook redelivery loses the race on the
unique index and is dropped. No read-then-write window, no lock, no dedupe
window to tune. A claim that cannot be completed is released, so a genuine retry
still lands. — `services/bridge/src/storage/message-map.ts`

**Sends are chained per conversation.** A text is a two-millisecond call and a
photo a five-second one, so a naive implementation delivers an agent's messages
out of order to one customer while staying fast for everyone else. Sends are
serialised per conversation and parallel across conversations.
— `services/bridge/src/http/outbound.ts`

**The webhook is answered before the work is done.** Chatwoot's webhook timeout
is shorter than the time a gateway needs to push a file, so waiting marked
delivered files as failed and turned the retry button into a duplicate. The
claim above is what makes answering early safe.

**The analytics sync takes a lease.** A row in `bridge.sync_state` acquired by
`UPDATE`, with a token fence so an expired worker cannot write over a live one.
It walks Chatwoot's pages incrementally to a watermark, inside a time budget, and
never throws — a failed sync is a line of text on the page, not a blank screen.
— `apps/panel/src/lib/sync.ts`

**Day boundaries live in one module.** "Today" means the team's today, not the
server's. Getting this wrong put an evening conversation on the following day and
split a shift across two rows. — `apps/panel/src/lib/business-time.ts`

**Configuration, not code.** Lines, fallbacks and the inactivity threshold are
rows in Postgres, read through a short-lived cache shared with the console.
Adding a number routes traffic without a deploy.

## Stack

| | |
|---|---|
| Bridge | Node 22, TypeScript (ESM), Fastify 5, `pg`, pino, `node:test` |
| Console | Next.js 16 (App Router), React 19, Tailwind 4, Recharts, Supabase Auth |
| Data | Postgres — two schemas: `evolution` and `bridge` |
| Gateway | [Evolution API](https://github.com/EvolutionAPI/evolution-api), self-hosted, one instance per number |
| Inbox | Chatwoot, via its API-channel inbox |
| Runs on | Docker Compose behind Caddy on one small VM; console on Vercel; image built in GitHub Actions |

No Redis and no queue broker: ordering is per-conversation chaining, and
deduplication is a unique index.

## Layout

```
services/bridge/     the bridge — see its own README for a folder-by-folder map
apps/panel/          the operator console (Next.js)
infra/local/         local Postgres and gateway for development
infra/gcp/           provisioning, Compose, Caddy, deploy script
scripts/             environment loading and helpers
docs/                design notes — the reasoning, not the API surface
```

## Running it

Needs Node 22+, pnpm, Docker (for the gateway), a Chatwoot account, and a
Supabase project (the hosted database and the console's login).

```bash
pnpm install
pnpm db:setup           # local Postgres standing in for the hosted database
cp .env.example .env    # then fill it in — every value is documented in place
```

Bring up the gateway by following [docs/01-evolution.md](docs/01-evolution.md),
then:

```bash
pnpm dev:bridge         # the bridge on :3001
pnpm dev:panel          # the console on :3000
```

`.env.example` is the full inventory of what has to be provisioned and why. No
secret is ever hardcoded; `.env` is never committed.

### Checks

```bash
pnpm typecheck                              # both packages
pnpm --filter @multiline/bridge test
pnpm --filter @multiline/panel test
pnpm build
```

The suites are `node:test` with no framework and no mocking library — the logic
worth testing is deliberately kept free of I/O so it can be called directly.

### Configuration worth knowing about

| | |
|---|---|
| `NEXT_PUBLIC_BUSINESS_TIMEZONE` + `..._UTC_OFFSET_HOURS` | Which timezone a "day" is measured in. Must be a fixed-offset zone; the test suite checks the pair against Node's own zone data. |
| `EVOLUTION_*` | The gateway: base URL, API key, and the secret its webhooks carry. |
| `CHATWOOT_*` | The account, the API token, and the webhook secret. |
| `RESEND_API_KEY` | Alert email. Without it an alert is logged instead of sent. |

## Design notes

- [docs/01-evolution.md](docs/01-evolution.md) — gateway configuration, and the
  transaction-mode pooling trap that only shows up under load
- [docs/02-deployment.md](docs/02-deployment.md) — the machine, TLS without a
  domain, and three failures that leave a healthy-looking stack doing the wrong thing
- [docs/03-availability.md](docs/03-availability.md) — setting inactive agents
  Offline, and recording who was online
- [docs/04-funnel.md](docs/04-funnel.md) — the reporting screen and where each
  figure comes from

Design decisions are also written at the top of the file they apply to, which is
usually the first thing worth reading in any module here.

## License

[MIT](LICENSE)
