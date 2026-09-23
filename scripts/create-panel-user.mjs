// Create (or reset) a Operator Console login, already confirmed.
//
// Sign-ups are switched off in the Supabase dashboard on purpose — see
// docs/02-deployment.md — so an account cannot be made from the panel or with
// the anon key. Making
// one is an administrator action, and this is that action as a command instead of a
// dozen clicks.
//
// The service-role key is NOT read from .env and must never be put there. It can
// read and write every table in the project, and .env is shared with the bridge and
// the panel, neither of which has any business holding it. Pass it for the one
// command:
//
//   SUPABASE_SERVICE_ROLE_KEY=… node --import ./scripts/load-env.mjs \
//     scripts/create-panel-user.mjs someone@example.com 'their-password'
//
// The key is in the Supabase dashboard under Project Settings → API → service_role.
// Copy it, run the command, and close the tab. It is not stored anywhere by this
// script, and the password is never printed.
//
// Existing account? Its password is reset and it is marked confirmed. That makes
// this safe to re-run, and it is also the manual way out if someone is locked out
// and email is not working yet.

import { argv, env, exit } from 'node:process'

const [email, password] = argv.slice(2)

function fail(message) {
  console.error(`\n  ${message}\n`)
  exit(1)
}

if (!email || !password) {
  fail(
    'Usage: SUPABASE_SERVICE_ROLE_KEY=… node --import ./scripts/load-env.mjs \\\n' +
      "    scripts/create-panel-user.mjs <email> '<password>'",
  )
}

const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '')
const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim()

if (!url) fail('SUPABASE_URL is not set. Run this with --import ./scripts/load-env.mjs.')
if (!key) {
  fail(
    'SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
      '  Supabase dashboard → Project Settings → API → service_role.\n' +
      '  Pass it on the command line for this one run; do not add it to .env.',
  )
}

// The anon key is also a JWT, and pasting the wrong one produces a puzzling 401
// rather than an explanation. Say which one is wrong before spending a request.
try {
  const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role
  if (role !== 'service_role') {
    fail(`That key is the "${role}" key, not service_role. Only service_role may create users.`)
  }
} catch {
  fail('That does not look like a Supabase key. Copy the service_role key from Project Settings → API.')
}

const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }

async function api(path, init) {
  const response = await fetch(`${url}/auth/v1${path}`, { ...init, headers })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, body }
}

/** The existing account for this address, or null. */
async function find() {
  const { ok, body } = await api(`/admin/users?per_page=200`, { method: 'GET' })
  if (!ok) return null
  return (body.users ?? []).find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null
}

const existing = await find()

const result = existing
  ? await api(`/admin/users/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password, email_confirm: true }),
    })
  : await api('/admin/users', {
      method: 'POST',
      // email_confirm: the account is usable immediately, with no confirmation mail
      // to wait for. Same as ticking "Auto Confirm User" in the dashboard.
      body: JSON.stringify({ email, password, email_confirm: true }),
    })

if (!result.ok) {
  fail(
    `Supabase refused (${result.status}): ${result.body.msg ?? result.body.message ?? JSON.stringify(result.body)}`,
  )
}

const user = result.body
console.log(
  `\n  ${existing ? 'Password reset for' : 'Created'} ${user.email}` +
    `\n  id        ${user.id}` +
    `\n  confirmed ${user.email_confirmed_at ? 'yes' : 'NO — check the dashboard'}` +
    `\n\n  Remember PANEL_ALLOWED_EMAILS: if it is set, this address has to be on it.\n`,
)
