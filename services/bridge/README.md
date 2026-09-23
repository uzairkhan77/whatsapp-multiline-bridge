# The bridge

Carries WhatsApp messages between the Evolution gateway and Chatwoot, assigns
new conversations to agents, and keeps the small amount of state that needs
keeping. One Node process, Fastify, Postgres. `src/index.ts` wires it together
and starts it; everything else is in a folder named for what it holds.

| Folder | What is in it |
|---|---|
| `src/context.ts` | The bag of services `index.ts` builds once and hands to every handler and job. |
| `src/http/` | The two webhook handlers — `inbound.ts` (WhatsApp → Chatwoot) and `outbound.ts` (Chatwoot → WhatsApp) — plus health and request logging. |
| `src/jobs/` | The background passes: webhook registration with Evolution, and the fifteen-minute agent pass (presence and auto-offline). |
| `src/clients/` | Talking to other systems: Chatwoot, Evolution, Resend for email. |
| `src/routing/` | Agent availability: the auto-offline rule and the presence record. |
| `src/media/` | Files, voice notes, shared contacts and locations. |
| `src/alerts/` | Line-down and reconnect alerts, and the wording of every email. |
| `src/storage/` | The database: `db.ts` is the connection, `schema.ts` creates the tables, `migrate.ts` runs the one-time boot steps, and each table's reads and writes are in a module named after it. |
| `src/core/` | Configuration, logging, phone-number handling, secrets at rest. |
| `test/` | Mirrors `src/` folder for folder. |

```
pnpm --filter @multiline/bridge test        # node:test over test/**
pnpm --filter @multiline/bridge typecheck   # src and test
pnpm --filter @multiline/bridge build       # src only → dist/
```

The design decisions are written where they apply — at the top of each file
and in `docs/` at the repo root (gateway, deployment, availability, funnel).
