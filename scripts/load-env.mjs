// Loads the environment for local development, in two layers.
//
//   .env                 everything shared — credentials, database, Chatwoot, Supabase
//   .env.backend.live    endpoints when talking to the VM
//   .env.backend.local   endpoints when talking to a gateway on this machine
//
// USE_LIVE_BACKEND in .env picks the second layer, and only the second layer.
// Credentials are not duplicated between the two files: the same Supabase project
// and the same gateway key serve both, so the only thing that changes when you
// switch is *which addresses* the services talk to. Two full copies of a .env drift
// within a week, and the half that drifts is always the one holding a secret.
//
// This runs only in local development. Vercel and the VM set their variables
// directly — there is no .env on either, and no copy of this file is shipped to
// them (infra/gcp/deploy.sh packs a fixed list of paths that does not include it).
// Every read below tolerates a missing file, so nothing here can break a deployment.
//
// Used by:
//   apps/panel/next.config.mjs      imported directly
//   services/bridge  package.json   node --import ../../scripts/load-env.mjs
//
// Both entry points need the same answer. If they ever loaded different files, the
// panel would report a line's status from one gateway while the bridge served a
// different one, and the screen would be confidently wrong.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'dotenv'

// Resolved from this file's own location, not from the working directory. The
// bridge runs from services/bridge and the panel from apps/panel, and a relative
// path would mean a different thing in each.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Read one env file into process.env.
 *
 * `override` is the whole reason this is not Node's built-in `--env-file` or
 * `process.loadEnvFile`: both leave an already-set variable alone, so a second file
 * can add but never replace — which is exactly what an overlay has to do.
 *
 * A variable already present in the real environment still wins over both files.
 * That keeps `USE_LIVE_BACKEND=false pnpm dev` working as a one-off override
 * without editing anything.
 */
function load(file, { override }) {
  const path = join(ROOT, file)
  if (!existsSync(path)) return false

  const parsed = parse(readFileSync(path))
  for (const [key, value] of Object.entries(parsed)) {
    if (override ? !preset.has(key) : !(key in process.env)) process.env[key] = value
  }
  return true
}

// Captured before anything is loaded, so "was this set by the shell?" stays
// answerable after the base file has populated process.env.
const preset = new Set(Object.keys(process.env))

load('.env', { override: false })

const live = (process.env.USE_LIVE_BACKEND ?? 'true').trim().toLowerCase() !== 'false'
const overlay = live ? '.env.backend.live' : '.env.backend.local'

if (!load(overlay, { override: true })) {
  console.warn(
    `[env] ${overlay} not found — falling back to whatever .env and the shell provide. ` +
      `See .env.example for what belongs in it.`,
  )
}

// Printed every start, deliberately. The single most confusing failure in this
// project is looking at real numbers while pointed at the wrong backend, or the
// reverse. One line at startup costs nothing and removes the question.
//
// stderr, not stdout. This module is preloaded before anything else runs, so on
// stdout it would prepend itself to the output of any script that produces a value
// — and the corruption is invisible until something downstream parses it.
console.error(
  `[env] backend: ${live ? 'LIVE (the VM)' : 'LOCAL'} · gateway ${process.env.EVOLUTION_BASE_URL ?? '(unset)'}`,
)
