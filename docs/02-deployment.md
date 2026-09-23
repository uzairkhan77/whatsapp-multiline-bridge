# Deployment

One small VM runs the gateway and the bridge under Docker Compose, behind Caddy.
The operator console deploys separately to Vercel. Postgres is hosted (Supabase),
so nothing stateful lives on the machine except the WhatsApp session files.

```
                   ┌──────────────── the VM ────────────────┐
   WhatsApp ──────▶│  Evolution (gateway)  ──▶  bridge      │──▶ Chatwoot
                   │            ▲                    ▲      │
                   │            └──── Caddy (TLS) ───┘      │
                   └───────────────────┬────────────────────┘
                                       │
                          Postgres (hosted) ◀── operator console (Vercel)
```

Three hostnames on one machine: the gateway, the bridge's webhook endpoint, and —
if you host the console yourself rather than on Vercel — the console.

## Sizing

A two-vCPU / 2 GB instance is enough to *run* this, and not enough to *build* it.
Compiling TypeScript and installing a dependency tree next to a live WhatsApp
gateway was the one step of a deploy that could run the machine out of memory, and
the gateway losing its socket means every number reconnects.

So the container image is built in CI (`.github/workflows/bridge-image.yml`) and
pushed to a registry; `infra/gcp/deploy.sh` only pulls it. Building is automatic,
deploying is a person running a script.

Add a swap file anyway — it costs nothing and turns one bad afternoon into a slow
one.

## TLS without owning a domain

Caddy gets a real certificate per hostname using a wildcard DNS service that
resolves `anything.<ip>.sslip.io` to `<ip>`. No DNS records to manage and no
self-signed certificate warnings, which matters because Chatwoot and the WhatsApp
gateway both refuse to post webhooks to a certificate they cannot verify.

Certificates are issued on the first request to each hostname, so the first load
after a deploy is slow and every one after it is not.

Swap in a real domain by changing the hostnames in `.env` and the Caddyfile;
nothing else in the stack knows the difference.

## Deploying

```bash
infra/gcp/deploy.sh                    # pull `latest` and restart
infra/gcp/deploy.sh --tag sha-abc1234  # a specific build — this is how you roll back
```

The script ships the compose file and the Caddyfile, checks the machine is logged
in to the registry, pulls, restarts what changed, and prunes. A deploy that only
changes the bridge leaves the gateway container untouched, so the WhatsApp
connections stay up.

## Console authentication

Supabase Auth, email and password, with sign-ups **disabled** in the Supabase
dashboard — accounts are created deliberately:

```bash
node scripts/create-panel-user.mjs you@example.com
```

`PANEL_ALLOWED_EMAILS` is an optional second gate. Empty means any confirmed user
in the project may sign in, which is only safe while sign-ups are off.

### `proxy.ts`, not `middleware.ts`

Next 16 renamed the convention, and the rename is what makes this correct rather
than merely working. A proxy file **always runs on the Node runtime**, so
`process.env` in it is the real environment the app loaded from the repository-root
`.env` in `next.config.mjs`.

Edge middleware would instead be handed values inlined at build time from the app's
own `.env` files, which this repo deliberately does not have — the console reads the
root `.env` like every other service. The auth variables would have been undefined
locally and defined in production: working when deployed, failing only on the
machine where it is being tested.

Do not add `export const runtime` to that file. A proxy file is not allowed one and
the build fails.

## Three traps, all of which fail quietly

Each of these produces a running, healthy-looking stack that does the wrong thing.

### `DATABASE_CONNECTION_CLIENT_NAME` is a namespace, not a label

It reads like a display name for a dashboard. It is not. Evolution stamps it onto
every row in `Instance` and **filters every lookup by it**. Two deployments with
different values share a database and see nothing of each other's lines.

Set it to something new and the gateway finds zero instances, and every webhook
registration fails with

```
Cannot read properties of undefined (reading 'instanceId')
```

which means "that instance does not exist", not "something is broken".

The consequence worth remembering: **two gateways must never share a namespace and
a set of sessions.** WhatsApp allows one socket per session, so both instances kick
each other off in a loop. The symptom is a flapping connection, not a clean error.
Keep a local gateway stopped while the deployed one is live, or give it its own
namespace and its own numbers.

### Do not pass `--project-directory` to Compose

Compose resolves every relative path in a compose file against the project
directory, which defaults to the directory the compose file is in. `compose.yaml`
is written that way: `../../.env`, `context: ../..`, `./Caddyfile`.

Passing `--project-directory` moves that origin and breaks all three at once. The
visible symptom is only the first: `env file /.env not found`.

### `--env-file` and `env_file:` are different things, and both are needed

`env_file:` inside the compose file hands variables to a **container at run time**.
`--env-file` on the command line supplies the values Compose substitutes into
`${...}` **while reading the file itself**, and by default it reads only the project
directory's `.env` — where there is none.

Without it, `BRIDGE_PUBLIC_URL: https://${WA_BRIDGE_HOST}` becomes the literal
string `https://`, and the bridge registers every webhook at that address. Compose
prints a warning, the containers start, and the health checks pass.

## Database region

The VM and the database should sit in the same region. This stack was moved once
for latency reasons and the database was left behind, which added a round trip of
well over a hundred milliseconds to every query — invisible in a health check and
obvious on a page that makes a dozen of them.

See [01-evolution.md](01-evolution.md) for the pooling configuration, which has a
trap of its own.
