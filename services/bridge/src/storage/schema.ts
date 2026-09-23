// Every bridge.* table, created on boot. The bridge owns the schema; the
// Operator Console reads and writes these tables but never creates them.

// storage
import type { Db } from './db.js'

export async function ensureSchema(db: Db): Promise<void> {
  await db.pool.query(`
    create schema if not exists bridge;

    -- Which WhatsApp line feeds which Chatwoot inbox, and what each falls back to. The only
    -- source of truth for routing; constraints live here so they also bind the panel's writes.
    create table if not exists bridge.lines (
      instance          text        primary key,
      -- One inbox per line, or a reply can leave on a number the customer never wrote to. Null =
      -- detached in the panel: routes nothing. Never delete the row: the FK would drop it as others' fallback.
      chatwoot_inbox_id integer     unique,
      -- Line to send through when this one is down. Null means no fallback: outbound
      -- fails loudly rather than going out from an unrecognised number.
      fallback_instance text,
      -- Take a line out of service without losing its configuration.
      enabled           boolean     not null default true,
      created_at        timestamptz not null default now(),
      updated_at        timestamptz not null default now(),

      -- A line nominating itself passes any existence check and is still useless when down.
      constraint lines_no_self_fallback
        check (fallback_instance is distinct from instance),
      -- A fallback naming a line we do not have must fail at write time, not when needed.
      constraint lines_fallback_exists
        foreign key (fallback_instance) references bridge.lines (instance)
        on update cascade on delete set null
    );

    -- Databases created before detaching existed have chatwoot_inbox_id not null. Guarded
    -- so the alter, which takes an exclusive lock, runs once rather than on every start.
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
         where table_schema = 'bridge'
           and table_name   = 'lines'
           and column_name  = 'chatwoot_inbox_id'
           and is_nullable  = 'NO'
      ) then
        alter table bridge.lines alter column chatwoot_inbox_id drop not null;
      end if;
    end $$;

    -- The Chatwoot account this system posts into. One row, and the check makes a second
    -- impossible. Written from the Operator Console, read by the bridge through a 30-second cache.
    create table if not exists bridge.chatwoot_settings (
      id             integer     primary key default 1 check (id = 1),
      base_url       text        not null,
      -- Text, not integer: Chatwoot account ids are opaque identifiers built into URLs.
      account_id     text        not null,
      api_token      text        not null,
      webhook_secret text        not null,
      updated_at     timestamptz not null default now()
    );

    -- Who gets alerted when something needs a person. Written from the Operator
    -- Console's Settings screen; read by the disconnect alerts in alerts.ts.
    create table if not exists bridge.notification_emails (
      email      text        primary key,
      created_at timestamptz not null default now(),
      constraint notification_emails_shape check (position('@' in email) > 1)
    );

    -- Alert email goes through Resend (see mailer.ts). A legacy bridge.smtp_settings table is
    -- never dropped here: nothing reads it, but it may hold a credential someone still needs.

    -- Cached Chatwoot agent roster, so the console can show names without one API call per
    -- page. Not a source of truth — Chatwoot is. synced_at says how old this copy is.
    create table if not exists bridge.chatwoot_agents (
      id           integer     primary key,
      name         text        not null,
      email        text,
      availability text        not null default 'unknown',
      synced_at    timestamptz not null default now()
    );

    -- Reports key agents by email, so that is what is indexed.
    create index if not exists chatwoot_agents_email_idx
      on bridge.chatwoot_agents (lower(email));

    -- The inactivity rule's switch and limit, one row (docs/03-availability.md). Off by default:
    -- it changes a person's own account, so somebody must switch it on, not a deployment.
    create table if not exists bridge.auto_offline_settings (
      id      integer not null primary key default 1 check (id = 1),
      enabled boolean not null default false,
      -- How long a customer may wait, and an agent may be silent, before the agent is set Offline.
      -- 30 minutes is a sensible default; the range stops a typo making it a second or a month.
      threshold_minutes integer not null default 30
        check (threshold_minutes between 1 and 1440),
      updated_at timestamptz not null default now()
    );

    -- When each agent last said anything. Written from the Chatwoot webhook for every agent reply
    -- and private note (notes count: the question is "are they there"). One row per agent; never grows.
    create table if not exists bridge.agent_activity (
      chatwoot_agent_id integer     not null primary key,
      last_message_at   timestamptz not null
    );

    -- Every time an agent was set Offline by the rule above, and why. Append-only; name and
    -- email are kept as they were so the record stays readable after the Chatwoot account is gone.
    create table if not exists bridge.agent_offline_events (
      id                       bigserial   primary key,
      chatwoot_agent_id        integer     not null,
      agent_name               text,
      agent_email              text,
      -- The conversation that was waiting. Null should not happen, but the record is kept anyway.
      chatwoot_conversation_id bigint,
      -- When the customer started waiting, and how long they had waited by the time this ran.
      waiting_since            timestamptz,
      waited_minutes           integer,
      -- The limit in force at the time, so the list stays readable after the setting changes.
      threshold_minutes        integer,
      created_at               timestamptz not null default now()
    );

    create index if not exists agent_offline_events_recent_idx
      on bridge.agent_offline_events (created_at desc);

    -- Availability history (docs/03-availability.md, presence.ts): one row per unbroken stretch of one
    -- status, seen_at moved forward each 15-minute pass; every status recorded, Offline included. Gaps are never counted.
    create table if not exists bridge.agent_presence (
      id                bigserial   primary key,
      chatwoot_agent_id integer     not null,
      status            text        not null
                        check (status in ('online', 'busy', 'offline', 'unknown')),
      since_at          timestamptz not null,
      seen_at           timestamptz not null,
      check (seen_at >= since_at)
    );

    -- The tick reads the latest row per agent; the panel reads a span of days.
    create index if not exists agent_presence_agent_seen_idx
      on bridge.agent_presence (chatwoot_agent_id, seen_at desc);

    create table if not exists bridge.message_map (
      id                       bigserial primary key,
      instance                 text        not null,
      evolution_message_id     text,
      chatwoot_message_id      bigint,
      chatwoot_conversation_id bigint,
      direction                text        not null check (direction in ('inbound', 'outbound')),
      -- The line the message actually went out on: the fallback when one carried it,
      -- while instance stays the line the conversation belongs to.
      sent_via_instance        text,
      created_at               timestamptz not null default now()
    );

    -- Deduplication is these two indexes: a webhook retry loses the race to insert and is dropped.
    create unique index if not exists message_map_evolution_uq
      on bridge.message_map (instance, evolution_message_id)
      where evolution_message_id is not null;

    create unique index if not exists message_map_chatwoot_uq
      on bridge.message_map (chatwoot_message_id)
      where chatwoot_message_id is not null;

    -- The Funnel's copy of what it counts (docs/04-funnel.md): one row per Chatwoot conversation, never
    -- messages. Written only by the panel (apps/panel/src/lib/sync.ts); rows, not totals, so nothing drifts.
    create table if not exists bridge.conversations (
      id               bigint      primary key,
      inbox_id         integer,
      status           text,
      created_at       timestamptz not null,
      last_activity_at timestamptz,
      -- Null is unassigned. Counts key on the id, which Chatwoot never renames; the email is for people.
      assignee_id      integer,
      assignee_email   text,
      synced_at        timestamptz not null default now()
    );
    create index if not exists conversations_created_idx
      on bridge.conversations (created_at);
    create index if not exists conversations_inbox_created_idx
      on bridge.conversations (inbox_id, created_at);
    create index if not exists conversations_assignee_idx
      on bridge.conversations (assignee_id, created_at);

    -- Where each copy is up to, and who is refreshing it. Seeded so the panel's lease is always an
    -- update ("no row" = someone else holds it). A timestamp, not an advisory lock: a refresh spans seconds of HTTP.
    create table if not exists bridge.sync_state (
      source          text        primary key check (source in ('conversations')),
      -- Conversations: when the last complete run started. The next run asks Chatwoot
      -- for everything active since a couple of days before it.
      watermark_at    timestamptz,
      -- A walk through Chatwoot's pages in progress: next page, when it began, the day asked
      -- for (null = from the beginning, first fill or rebuild). Cleared when the walk ends.
      walk_page       integer,
      walk_started_at timestamptz,
      walk_since      date,
      -- What the source said it holds at the last complete run, for spotting a copy that fell short.
      source_total    integer,
      lease_token     text,
      lease_until     timestamptz,
      last_run_at     timestamptz,
      last_ok_at      timestamptz,
      last_rows       integer,
      last_error      text
    );
    insert into bridge.sync_state (source) values ('conversations')
      on conflict (source) do nothing;
  `)
}
