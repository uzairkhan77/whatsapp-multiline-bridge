# Evolution API — gateway configuration

Pinned against evolution-api **v2.3.7** (`fa09d37`). Vendored by clone into
`vendor/evolution-api`, which is gitignored — the version is pinned here, not
committed.

In production the same version runs as a published image,
`evoapicloud/evolution-api:v2.3.7` — **not** `atendai/evolution-api`, the name most
documentation still gives, which stops at v2.2.3. The project changed publishing
organisation around this version; the vendored commit `fa09d378` records the same
reorganisation. See [02-deployment.md](02-deployment.md).

Configuration lives in `infra/local/evolution.env` (gitignored) and is symlinked
to `vendor/evolution-api/.env`, because Evolution calls `dotenv.config()` against
its own working directory. Only `infra/local/evolution.env.example` is tracked.

## Running it locally

```
pnpm db:setup                                  # local Postgres stand-in
cp infra/local/evolution.env.example infra/local/evolution.env
# fill in AUTHENTICATION_API_KEY
ln -sf ../../infra/local/evolution.env vendor/evolution-api/.env
cd vendor/evolution-api && npm install && npm run db:deploy && npm run db:generate
cd - && infra/local/evolution.sh start
```

`infra/local/evolution.sh` takes `start|stop|restart|status|logs` and tracks the
process by pidfile. Do not stop it with `pkill -f main.ts` — that pattern also
matches the shell issuing the command.

## Transaction-mode pooling

This is the setting the whole gateway rests on, and the one that fails quietly.

Evolution ships three Prisma schemas. The provider selects which one is
generated, via `runWithProvider.js`:

| `DATABASE_PROVIDER` | schema generated | Prisma `url` | Prisma `directUrl` |
|---|---|---|---|
| `postgresql` | `postgresql-schema.prisma` | `DATABASE_CONNECTION_URI` | *(none)* |
| `psql_bouncer` | `psql_bouncer-schema.prisma` | `DATABASE_BOUNCER_CONNECTION_URI` | `DATABASE_CONNECTION_URI` |

**We use `psql_bouncer`.** The plain `postgresql` provider gives Prisma no
`directUrl`, so it runs migrations and its runtime client down the same pooled
connection. Against a transaction-mode pooler that is what produces the
intermittent `prepared statement "s0" already exists` errors under load: in
transaction mode a connection is handed back to the pool between statements, so
the prepared statement Prisma cached is not there the next time it looks, or
belongs to another session.

So both URIs must be set, and they are not interchangeable:

```
DATABASE_BOUNCER_CONNECTION_URI=...:6543/postgres?pgbouncer=true&connection_limit=10  # runtime
DATABASE_CONNECTION_URI=...:5432/postgres                                             # migrations only
```

On Supabase, port 6543 is the transaction-mode pooler and 5432 is the session-mode
pooler — not `db.<ref>.supabase.co`, which is IPv6-only and unreachable from
networks without v6 transit. `pgbouncer=true` tells Prisma to stop using named
prepared statements.

`connection_limit` is **10, not 1**. One is Prisma's guidance for serverless, where
each invocation is a separate short-lived process. Evolution is a long-running
server, so 1 serialises every query onto a single connection: measured against the
real pooler, the ceiling was about 5 concurrent requests and 89% of a 300-request
run failed with "Timed out fetching a new connection from the connection pool" —
a client-side limit, not any pooler-side error. The same run at 10 failed none.
Worth re-checking whenever a number is added.

Locally both point at the same Postgres, so the pooled code path is the one
development actually exercises.

Verify the generated client is the pooled one — this reads the artifact, not the
intent:

```
grep -A3 '^datasource' vendor/evolution-api/node_modules/.prisma/client/schema.prisma
```

It must show `url = env("DATABASE_BOUNCER_CONNECTION_URI")` and a `directUrl`.
Re-run `npm run db:generate` after any provider change; the generated client is
stale otherwise and the symptom is the same intermittent error.

One difference between the two schemas beyond the datasource: the `psql_bouncer`
schema drops `@@unique([instanceId, remoteJid])` on `Chat`. The migrations are
shared, so the constraint is still in the database. It does not affect us —
chat persistence is off.

## Persistence flags

`DATABASE_SAVE_DATA_INSTANCE=true` is the only one on. Everything else is off:
Chatwoot is the system of record for conversations and we do not keep a second
copy of customer messages.

Session and instance state persist regardless of the message flags. Baileys
credentials are written to the `Session` table by
`src/utils/use-multi-file-auth-state-prisma.ts`, which is on the unconditional
path when Redis is disabled — so a container restart does not drop connections.

### The Chatwoot retention question, resolved

The requirement allowed for keeping a minimum retention if Evolution's Chatwoot
integration needed it for message-ID mapping. It does: with `CHATWOOT_ENABLED=true`,
`chatwoot.service.ts` reads the `Message` table to map deletes, resolve quoted
messages, and track read status — which would force
`DATABASE_SAVE_DATA_NEW_MESSAGE=true` and put a full copy of every customer
message in our Supabase project.

**We do not use it.** The bridge described in section 4 of the requirements is our
own service, so `CHATWOOT_ENABLED=false` and none of that code path runs. The
message-ID mapping lives in the bridge's own table and holds identifiers only —
WhatsApp message id, Chatwoot message id, instance, direction, timestamp — with
no message content. Retention needed from Evolution: none.

## Instance lifecycle

All calls take `apikey: $AUTHENTICATION_API_KEY`.

| Operation | Call |
|---|---|
| Create + QR | `POST /instance/create` `{instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true}` |
| Connect / fresh QR | `GET /instance/connect/{name}` |
| Connection state | `GET /instance/connectionState/{name}` → `open` \| `close` \| `connecting` |
| List all | `GET /instance/fetchInstances` |
| Log out | `DELETE /instance/logout/{name}` |
| Delete | `DELETE /instance/delete/{name}` |
| Set webhook | `POST /webhook/set/{name}` |
| Read webhook | `GET /webhook/find/{name}` |

Webhooks are configured per instance, not globally (`WEBHOOK_GLOBAL_ENABLED=false`),
so one line can be taken out without touching the others.

## Verified on 2026-08-27

- Create returns a scannable QR; `connectionState` reports `connecting`.
- Per-instance webhook set and read back with its event list intact.
- Instance and webhook configuration survive a full process restart, reloaded
  from Postgres.
- 60 concurrent authenticated reads: 60 × HTTP 200, no prepared-statement,
  `P2024`, or connection-pool errors in the log.
- With every message flag off, `Message`, `Chat`, `Contact`, `MessageUpdate`,
  `IsOnWhatsapp` and `Label` all stay at zero rows while `Instance` and `Session`
  populate.
- `DELETE /instance/delete` cascades: `Instance`, `Session` and `Webhook` all
  return to zero.

## Not yet verified, and why

- **Session restore across a restart of a *connected* line.** What is proven is
  that instance and webhook state reload from the database. Proving that an
  `open` connection resumes without a fresh QR needs a real number scanned in.
- **Behaviour against a real transaction-mode pooler.** Local Postgres has no
  pgbouncer in front of it, so the failure mode this section guards against
  cannot be reproduced here. The configuration is correct by construction and
  confirmed in the generated client, but the load test that means anything is the
  one run against the dedicated Supabase project's 6543 endpoint. Re-run it there
  before anything is built on top.
- **Webhook deduplication.** Needs the bridge receiving real events.
