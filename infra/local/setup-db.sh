#!/usr/bin/env bash
# Local stand-in for the dedicated Supabase project.
#
# Creates a non-superuser role and two databases so local connection strings have
# the same shape as the Supabase pooler URLs we swap in later (host/port/user/password).
# Nothing here runs on the VPS — the VPS has no database on the box.
#
# Idempotent: safe to re-run.
#
# Env:
#   LOCAL_PG_PASSWORD  password for the wa_local role (default: wa_local_dev)
#   PGHOST/PGPORT      passed through to psql (default: local socket)

set -euo pipefail

ROLE="${LOCAL_PG_ROLE:-wa_local}"
PASSWORD="${LOCAL_PG_PASSWORD:-wa_local_dev}"
EVOLUTION_DB="${LOCAL_EVOLUTION_DB:-wa_evolution}"
BRIDGE_DB="${LOCAL_BRIDGE_DB:-wa_bridge}"

# Connect as the current OS user via peer auth; must be a Postgres superuser.
psql_admin() { psql -v ON_ERROR_STOP=1 -d postgres "$@"; }

echo "==> Checking admin connectivity"
psql_admin -tAc "select 'connected as ' || current_user"

echo "==> Role: ${ROLE}"
if [ "$(psql_admin -tAc "select 1 from pg_roles where rolname = '${ROLE}'")" = "1" ]; then
  psql_admin -c "alter role ${ROLE} with login password '${PASSWORD}'" >/dev/null
  echo "    exists, password reset"
else
  psql_admin -c "create role ${ROLE} with login password '${PASSWORD}'" >/dev/null
  echo "    created"
fi
# Evolution's Prisma migrations create extensions and types, so it needs CREATEDB-free
# but schema-owning rights on its own database. Owning the database covers that.

for db in "${EVOLUTION_DB}" "${BRIDGE_DB}"; do
  echo "==> Database: ${db}"
  if [ "$(psql_admin -tAc "select 1 from pg_database where datname = '${db}'")" = "1" ]; then
    echo "    exists"
  else
    psql_admin -c "create database ${db} owner ${ROLE}" >/dev/null
    echo "    created"
  fi
  psql_admin -c "alter database ${db} owner to ${ROLE}" >/dev/null
  psql -v ON_ERROR_STOP=1 -d "${db}" -c "grant all on schema public to ${ROLE}" >/dev/null
done

# The bridge creates its own tables on boot; it only needs the schema to exist and
# to be owned by the role its connection string uses.
echo "==> Schema: bridge (in ${BRIDGE_DB})"
psql -v ON_ERROR_STOP=1 -d "${BRIDGE_DB}" \
  -c "create schema if not exists bridge authorization ${ROLE}" >/dev/null
echo "    ready"

HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
cat <<EOF

Done. Connection strings for .env:

  EVOLUTION_DATABASE_URL=postgresql://${ROLE}:${PASSWORD}@${HOST}:${PORT}/${EVOLUTION_DB}
  BRIDGE_DATABASE_URL=postgresql://${ROLE}:${PASSWORD}@${HOST}:${PORT}/${BRIDGE_DB}

On Supabase these become the pooler URL (port 6543, transaction mode). Evolution
also wants a session-mode URL on port 5432 for its migrations, set as
DATABASE_CONNECTION_URI in its own env file. See .env.example.
EOF
