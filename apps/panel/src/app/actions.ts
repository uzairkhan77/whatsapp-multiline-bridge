'use server'

// framework
import { revalidatePath } from 'next/cache'

// enums
import { SourceStatus } from '@/enums/sync'

// types
import type {
  ActionResult,
  AutoOfflineSettingsInput,
  ChatwootSettingsInput,
  InboxOption,
} from '@/types/actions'
import type { ChatwootAgent, ChatwootInbox } from '@/types/chatwoot'

// lib
import { requireUser, supabase } from '@/lib/auth'
import {
  addInboxMembers,
  createApiInbox,
  deleteInbox,
  inboxNameKey,
  listAgents,
  listInboxes,
  setInboxWebhook,
} from '@/lib/chatwoot'
import { query, withLock } from '@/lib/db'
import { env } from '@/lib/env'
import * as evolution from '@/lib/evolution'
import { configuredLines } from '@/lib/lines'
import { sendEmail, utcTimestamp } from '@/lib/mailer'
import { encryptSecret } from '@/lib/secrets'
import { forgetChatwootSettings, getChatwootSettings, listNotificationEmails } from '@/lib/settings'
import { requestRebuild, syncFunnelSources } from '@/lib/sync'

// Re-exported: components/lines/LineActions.tsx still imports its own copy from here.
export type { InboxOption } from '@/types/actions'

// Server Actions compile to POST endpoints anyone holding the id can call
// directly, bypassing the page and middleware entirely. The rule for this file:
// every action that changes something starts with requireUser(). Logout and
// delete also destroy a line's WhatsApp session, which can only be re-scanned.

function failure(error: unknown, fallback: string): ActionResult {
  const message = error instanceof Error ? error.message : fallback
  return { ok: false, error: message }
}

export async function requestQr(
  instance: string,
): Promise<{ ok: true; base64: string | null; pairingCode: string | null } | ActionResult> {
  await requireUser()
  try {
    const qr = await evolution.connect(instance)
    return { ok: true, base64: qr.base64, pairingCode: qr.pairingCode }
  } catch (error) {
    return failure(error, 'Could not request a QR code')
  }
}

/** Polled by the QR dialog so the sheet closes itself the moment the scan lands. */
export async function checkState(instance: string): Promise<{ state: string }> {
  await requireUser()
  try {
    const state = await evolution.connectionState(instance)
    // The scan just landed: the list must not show "Waiting for scan" from a
    // reading taken before it did.
    if (state === 'open') evolution.forgetInstances()
    return { state }
  } catch {
    return { state: 'unknown' }
  }
}

/**
 * Create the line on the gateway, then attach a Chatwoot inbox (unless asked
 * not to). The line is created first; a failed inbox step is reported as a warning.
 */
export async function createLine(instance: string, withInbox = true): Promise<ActionResult> {
  await requireUser()
  const name = instance.trim()
  const makeInbox = withInbox !== false

  try {
    return await withInboxLock(async () => {
      // Checked here as well as live in the dialog: what the person saw may be a
      // minute old, and someone else may have taken the name since.
      const problem = await lineNameProblem(name)
      if (problem) return { ok: false, error: problem }

      await evolution.createInstance(name)
      evolution.forgetInstances()
      revalidatePath('/')
      if (!makeInbox) return { ok: true }

      // The line exists from here on, so nothing below may report plain failure —
      // pressing Create again would only hit the name it now holds. The dialog
      // shows any warning as a toast after it closes.
      let attached: ActionResult
      try {
        attached = (await inboxNameRefusal(name)) ?? (await createAndAttachInbox(name))
      } catch (error) {
        attached = failure(error, 'Chatwoot did not create it.')
      }
      if (!attached.ok) {
        return {
          ok: true,
          warning:
            `Line “${name}” was created, but its Chatwoot inbox was not. ${attached.error} ` +
            'Use “Assign inbox” on the line to connect one — until then, everything the ' +
            'number receives is dropped.',
        }
      }
      return attached
    })
  } catch (error) {
    return failure(error, 'Could not create the line')
  }
}

/**
 * The Add line dialog's live check, run as the name is typed — including on the
 * name the dialog opens with, which is only a suggestion and may already be taken.
 */
export async function checkLineName(name: string): Promise<ActionResult> {
  await requireUser()
  const problem = await lineNameProblem(name.trim())
  return problem ? { ok: false, error: problem } : { ok: true }
}

/**
 * Why a new line cannot have this name, or null when it can. Checks the gateway
 * and routing table only — Chatwoot is checked once, just before the inbox is
 * created, since this runs on every pause in typing.
 */
async function lineNameProblem(name: string): Promise<string | null> {
  // The name becomes a path segment in the webhook address the bridge registers.
  // Spaces and slashes there produce an address the gateway cannot post to, so the
  // failure would show up as a silently dead line rather than an error here.
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return 'Use letters, numbers, dots, dashes and underscores only — no spaces.'
  }

  const key = inboxNameKey(name)
  const [instances, lines] = await Promise.allSettled([
    evolution.fetchInstances(),
    configuredLines(),
  ])

  // The routing table counts too: a row left behind by a half-deleted line would
  // otherwise be silently inherited by a new line of the same name.
  const lineNames = [
    ...(instances.status === 'fulfilled' ? instances.value.instances.map((entry) => entry.name) : []),
    ...(lines.status === 'fulfilled' ? lines.value.map((line) => line.instance) : []),
  ]
  const sameLine = lineNames.find((existing) => inboxNameKey(existing) === key)
  return sameLine ? `A line named “${sameLine}” already exists. Choose a different name.` : null
}

export async function logoutLine(instance: string): Promise<ActionResult> {
  await requireUser()
  try {
    await evolution.logout(instance)
    evolution.forgetInstances()
    revalidatePath('/')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not log the line out')
  }
}

export async function deleteLine(instance: string): Promise<ActionResult> {
  await requireUser()
  try {
    try {
      await evolution.deleteInstance(instance)
    } catch (error) {
      // 404 means the gateway already forgot this line — that is the half-deleted
      // state this action exists to clean up, not a reason to stop.
      const status = error instanceof Error && 'status' in error ? (error as { status?: number }).status : null
      if (status !== 404) throw error
    }

    // The gateway finishes deleting in the background after it answers. Waiting
    // here means the page the person lands on no longer shows the line.
    await evolution.waitUntilGone(instance)

    // The routing row goes with the line — a leftover row would keep it on the
    // dashboard as routed-but-missing while the bridge retries its webhook.
    // A fallback_instance pointing here becomes null via the FK's on delete.
    await query(`delete from bridge.lines where instance = $1`, [instance])

    evolution.forgetInstances()
    revalidatePath('/')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not delete the line')
  }
}

export async function refresh(): Promise<void> {
  await requireUser()
  evolution.forgetInstances()
  revalidatePath('/')
}

// ─────────────────────────────────────────────────────────────────────────────
// Chatwoot settings — one row in bridge.chatwoot_settings, shared with the bridge
// ─────────────────────────────────────────────────────────────────────────────

export async function saveChatwootSettings(input: ChatwootSettingsInput): Promise<ActionResult> {
  await requireUser()

  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '') || 'https://app.chatwoot.com'
  const accountId = input.accountId.trim()
  const apiToken = input.apiToken.trim()
  const webhookSecret = input.webhookSecret.trim()

  if (!/^https?:\/\//.test(baseUrl)) {
    return { ok: false, error: 'The base URL must start with https:// (or http:// for a local install).' }
  }
  if (!/^\d+$/.test(accountId)) {
    return {
      ok: false,
      error: 'The account ID is the number in your Chatwoot URL — app.chatwoot.com/app/accounts/<this number>/…',
    }
  }

  try {
    // Blank secret fields mean "keep what is stored" — nullif/coalesce handles
    // that in SQL. On the first save there's nothing to fall back to, so blanks
    // are rejected here before the not-null constraint gives an unreadable error.
    const existing = await getChatwootSettings()
    const isFirstSave = !existing || existing.source === 'env'
    if (isFirstSave && (!apiToken || (!webhookSecret && !existing?.webhookSecret))) {
      return {
        ok: false,
        error: 'Nothing is saved yet, so the API token and webhook secret are both needed this first time.',
      }
    }

    // Encrypted here, never in SQL — the database must never see the plain value,
    // or a statement log defeats the point. An empty field stays empty so the
    // coalesce below reads it as "keep what is stored".
    const sealed = (value: string): string => (value ? encryptSecret(value) : '')

    await query(
      `insert into bridge.chatwoot_settings (base_url, account_id, api_token, webhook_secret)
       values ($1, $2,
               coalesce(nullif($3, ''), $5),
               coalesce(nullif($4, ''), $6))
       on conflict (id) do update
          set base_url       = excluded.base_url,
              account_id     = excluded.account_id,
              api_token      = coalesce(nullif($3, ''), bridge.chatwoot_settings.api_token),
              webhook_secret = coalesce(nullif($4, ''), bridge.chatwoot_settings.webhook_secret),
              updated_at     = now()`,
      // $5/$6 cover the insert arm, where there is no existing row to coalesce to:
      // the env fallback's values when migrating, otherwise the typed ones.
      [baseUrl, accountId, sealed(apiToken), sealed(webhookSecret),
       sealed(apiToken || existing?.apiToken || ''),
       sealed(webhookSecret || existing?.webhookSecret || '')],
    )

    forgetChatwootSettings()
    revalidatePath('/settings')
    revalidatePath('/')

    // A new webhook secret changes the URL every connected inbox must carry, so
    // push it to all of them now — otherwise delivery quietly breaks every line's
    // replies until someone re-pastes the URL by hand.
    if (webhookSecret && env.bridgePublicUrl) {
      const url = `${env.bridgePublicUrl}/webhooks/chatwoot?secret=${encodeURIComponent(webhookSecret)}`
      const lines = await configuredLines().catch(() => [])
      const failed: string[] = []
      for (const line of lines) {
        if (line.chatwootInboxId === null) continue
        await setInboxWebhook(line.chatwootInboxId, url).catch(() => failed.push(line.instance))
      }
      if (failed.length > 0) {
        return {
          ok: true,
          warning:
            `Saved, but the new webhook URL could not be written to the inbox for: ` +
            `${failed.join(', ')}. Paste it there from "Show webhook URL" below, or those ` +
            `lines' agent replies will stop reaching WhatsApp.`,
        }
      }
    }

    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not save the Chatwoot settings')
  }
}

/**
 * The full Chatwoot webhook URL, secret included — fetched on demand rather than
 * rendered into the page, so it exists only in the reply to an authenticated click.
 */
export async function getWebhookUrl(): Promise<{ ok: true; url: string } | ActionResult> {
  await requireUser()
  try {
    const settings = await getChatwootSettings()
    if (!settings?.webhookSecret) {
      return { ok: false, error: 'Save the Chatwoot settings first — the URL includes the webhook secret.' }
    }
    const base = env.bridgePublicUrl
    if (!base) {
      console.warn('[panel] BRIDGE_PUBLIC_URL is not set, so the webhook address cannot be shown')
      return { ok: false, error: 'The webhook address is not configured on this panel.' }
    }
    return { ok: true, url: `${base}/webhooks/chatwoot?secret=${encodeURIComponent(settings.webhookSecret)}` }
  } catch (error) {
    return failure(error, 'Could not read the settings')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification emails — stored now, read by step 8 (monitoring) when it lands
// ─────────────────────────────────────────────────────────────────────────────

export async function addNotificationEmail(email: string): Promise<ActionResult> {
  await requireUser()

  const address = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return { ok: false, error: 'That does not look like an email address.' }
  }

  try {
    // `do nothing` makes re-adding an existing address a quiet success rather
    // than an error.
    await query(
      `insert into bridge.notification_emails (email) values ($1)
       on conflict (email) do nothing`,
      [address],
    )
    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not add the email address')
  }
}

export async function removeNotificationEmail(email: string): Promise<ActionResult> {
  await requireUser()
  try {
    await query(`delete from bridge.notification_emails where email = $1`, [email])
    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not remove the email address')
  }
}

/**
 * The agents Chatwoot knows about, with their current availability. Loaded on
 * demand, like the inbox picker, so the settings screen still opens if Chatwoot is down.
 */
export async function listChatwootAgents(): Promise<
  { ok: true; agents: ChatwootAgent[] } | ActionResult
> {
  await requireUser()
  try {
    return { ok: true, agents: await listAgents() }
  } catch (error) {
    return failure(error, 'Could not load the agents from Chatwoot')
  }
}

/**
 * When agents are set Offline automatically. The bridge caches this row for
 * thirty seconds, so switching the rule off takes effect within half a minute.
 */
export async function saveAutoOfflineSettings(
  input: AutoOfflineSettingsInput,
): Promise<ActionResult> {
  await requireUser()

  const minutes = Math.trunc(Number(input.thresholdMinutes))
  // The same range the column checks. Caught here so the operator reads a
  // sentence rather than a Postgres constraint name.
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    return {
      ok: false,
      error: 'Enter a limit between 1 minute and 1440 (24 hours).',
    }
  }

  try {
    await query(
      `insert into bridge.auto_offline_settings (enabled, threshold_minutes)
       values ($1, $2)
       on conflict (id) do update
          set enabled           = excluded.enabled,
              threshold_minutes = excluded.threshold_minutes,
              updated_at        = now()`,
      [input.enabled, minutes],
    )

    revalidatePath('/settings')
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not save the availability settings')
  }
}

/**
 * A real send through Resend to the real recipient list — alert email fails
 * invisibly otherwise, and this button moves that discovery to now.
 */
export async function sendTestEmail(): Promise<ActionResult> {
  await requireUser()
  try {
    const recipients = await listNotificationEmails()
    if (recipients.length === 0) {
      return { ok: false, error: 'Add at least one recipient above first — a test needs somewhere to go.' }
    }

    const result = await sendEmail(
      recipients,
      'Test alert from the Operator Console',
      'This is a test of the alert email setup. If you are reading it, ' +
        'disconnect alerts for the WhatsApp lines will reach this address.\n\n' +
        `Time: ${utcTimestamp()}`,
    )
    if (!result.ok) return { ok: false, error: result.error ?? 'The test send failed' }
    return { ok: true }
  } catch (error) {
    return failure(error, 'The test send failed')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Account
// ─────────────────────────────────────────────────────────────────────────────

export async function changePassword(current: string, next: string): Promise<ActionResult> {
  const user = await requireUser()

  if (next.length < 8) {
    return { ok: false, error: 'The new password needs at least 8 characters.' }
  }

  try {
    const client = await supabase()

    // Supabase does not require the old password to set a new one — the session
    // cookie alone would suffice, letting anyone at an unlocked machine lock the
    // owner out. Checking it here is what makes this a change, not a takeover.
    const { error: wrongPassword } = await client.auth.signInWithPassword({
      email: user.email ?? '',
      password: current,
    })
    if (wrongPassword) {
      return { ok: false, error: 'The current password is not correct.' }
    }

    const { error } = await client.auth.updateUser({ password: next })
    if (error) {
      // Supabase phrases some refusals well ("should be different from the old
      // password") — pass those through rather than flattening them.
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not change the password')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connecting an inbox to a line
// ─────────────────────────────────────────────────────────────────────────────

export async function listChatwootInboxes(): Promise<
  { ok: true; inboxes: InboxOption[] } | ActionResult
> {
  await requireUser()
  try {
    const [inboxes, lines] = await Promise.all([listInboxes(), configuredLines()])
    const byInbox = new Map(lines.map((line) => [line.chatwootInboxId, line.instance]))
    return {
      ok: true,
      inboxes: inboxes.map((inbox) => ({
        ...inbox,
        assignedTo: byInbox.get(inbox.id) ?? null,
      })),
    }
  } catch (error) {
    return failure(error, 'Could not load the inboxes from Chatwoot')
  }
}

export async function assignInbox(instance: string, inboxId: number): Promise<ActionResult> {
  await requireUser()

  if (!Number.isInteger(inboxId) || inboxId <= 0) {
    return { ok: false, error: 'Pick an inbox first.' }
  }
  return attachInbox(instance, inboxId)
}

/**
 * Point a line at an inbox and wire its reply webhook. Shared by picking an
 * existing inbox and creating a new one. Only a failed routing-row save returns
 * `ok: false`; anything after that is a warning, since the line is attached by then.
 */
async function attachInbox(instance: string, inboxId: number): Promise<ActionResult> {
  try {
    const [previous] = await query<{ inboxId: number | null }>(
      `select chatwoot_inbox_id as "inboxId" from bridge.lines where instance = $1`,
      [instance],
    )

    // Upsert into bridge.lines: "assign" and "change" are the same UI gesture and
    // the row may or may not exist yet. The table's constraints do the real
    // guarding; this code only translates their refusals.
    await query(
      `insert into bridge.lines (instance, chatwoot_inbox_id)
       values ($1, $2)
       on conflict (instance) do update
          set chatwoot_inbox_id = excluded.chatwoot_inbox_id,
              updated_at        = now()`,
      [instance, inboxId],
    )

    // The inbox this line fed until now would keep sending its replies to the
    // bridge, which ignores an inbox no line owns. Cleared anyway, so Chatwoot's
    // own settings say what is true.
    if (previous?.inboxId != null && previous.inboxId !== inboxId) {
      await setInboxWebhook(previous.inboxId, '').catch(() => {})
    }

    revalidatePath('/')
    revalidatePath('/lines/[instance]', 'page')

    // Without the webhook URL, the inbox receives messages but agent replies
    // never leave Chatwoot, silently. A failure here downgrades to a warning,
    // not a failed action, since the routing row is already saved.
    const settings = await getChatwootSettings()
    if (!settings?.webhookSecret || !env.bridgePublicUrl) {
      return {
        ok: true,
        warning:
          'Assigned — but the reply webhook could not be configured automatically. ' +
          'Paste the webhook URL from Settings into this inbox in Chatwoot, or agent ' +
          'replies will not reach WhatsApp.',
      }
    }
    try {
      await setInboxWebhook(
        inboxId,
        `${env.bridgePublicUrl}/webhooks/chatwoot?secret=${encodeURIComponent(settings.webhookSecret)}`,
      )
    } catch {
      return {
        ok: true,
        warning:
          'Assigned — but Chatwoot refused the webhook configuration. Paste the webhook ' +
          'URL from Settings into this inbox in Chatwoot, or agent replies will not reach WhatsApp.',
      }
    }

    return { ok: true }
  } catch (error) {
    // 23505 = unique violation on lines_chatwoot_inbox_id_key: the inbox already
    // feeds another line. Two people assigning at once can race past the picker's
    // own disabling, so the message should name the winner.
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      const owner = (await configuredLines().catch(() => []))
        .find((line) => line.chatwootInboxId === inboxId)
      return {
        ok: false,
        error: owner
          ? `That inbox already feeds ${owner.instance}. One inbox can only feed one line.`
          : 'That inbox already feeds another line. One inbox can only feed one line.',
      }
    }
    return failure(error, 'Could not assign the inbox')
  }
}

/**
 * Take the inbox off a line — only the link goes, not the line's settings or
 * the inbox's conversations. The bridge sees it within its 30-second cache.
 */
export async function detachInbox(instance: string): Promise<ActionResult> {
  await requireUser()
  try {
    const [row] = await query<{ inboxId: number | null }>(
      `with old as (select chatwoot_inbox_id from bridge.lines where instance = $1)
       update bridge.lines
          set chatwoot_inbox_id = null,
              updated_at        = now()
        where instance = $1
       returning (select chatwoot_inbox_id from old) as "inboxId"`,
      [instance],
    )

    revalidatePath('/')
    revalidatePath('/lines/[instance]', 'page')

    // Tidying, not safety: the bridge already ignores replies from an inbox no
    // line owns. Clearing the webhook stops Chatwoot calling the bridge for nothing.
    if (row?.inboxId != null) await setInboxWebhook(row.inboxId, '').catch(() => {})
    return { ok: true }
  } catch (error) {
    return failure(error, 'Could not detach the inbox')
  }
}

/**
 * A new inbox for a line that already exists — created before inboxes were
 * automatic, detached since, or one whose Create could not reach Chatwoot.
 */
export async function createInboxForLine(instance: string): Promise<ActionResult> {
  await requireUser()
  try {
    return await withInboxLock(async () => {
      const refusal = await inboxNameRefusal(instance)
      if (refusal) return refusal
      return await createAndAttachInbox(instance)
    })
  } catch (error) {
    return failure(error, 'Could not create the inbox')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbox names are never repeated
// ─────────────────────────────────────────────────────────────────────────────
//
// Chatwoot allows duplicate inbox names; the panel refuses to create one whose
// name — ignoring case and spaces — already exists. Check-then-create is guarded
// by a Postgres lock (not an in-memory one), held from check until the inbox is
// attached, so it holds across every running copy of the panel.

const INBOX_LOCK = 'panel:create-chatwoot-inbox'

async function withInboxLock(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await withLock(INBOX_LOCK, work)
  } catch (error) {
    // 55P03 = lock_not_available: another create held the lock past the timeout.
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '55P03') {
      return { ok: false, error: 'Another line or inbox is being created right now. Try again in a few seconds.' }
    }
    throw error
  }
}

/**
 * Null when no inbox has this name. Otherwise a refusal naming the inbox in the
 * way. Asked once, just before an inbox is created — never while a name is being
 * typed.
 */
async function inboxNameRefusal(name: string): Promise<ActionResult | null> {
  let inboxes: ChatwootInbox[]
  try {
    inboxes = await listInboxes()
  } catch (error) {
    // Not knowing is a refusal too: creating on a guess is how a repeat gets in.
    const reason = error instanceof Error ? error.message : 'Chatwoot did not answer'
    return { ok: false, error: `Chatwoot could not be reached to check the name (${reason}).` }
  }

  const key = inboxNameKey(name)
  const clash = inboxes.find((inbox) => inboxNameKey(inbox.name) === key)
  if (!clash) return null

  const owner = (await configuredLines().catch(() => [])).find(
    (line) => line.chatwootInboxId === clash.id,
  )
  const taken = `Chatwoot already has an inbox named “${clash.name}” (#${clash.id})`

  if (owner?.instance === name) {
    return { ok: false, error: `${taken}, and it is already this line's inbox.` }
  }
  return {
    ok: false,
    error: owner
      ? `${taken} — it feeds ${owner.instance}. Inbox names are never repeated.`
      : `${taken}, not attached to any line. Inbox names are never repeated.`,
  }
}

/**
 * Create an inbox named after the line, add every agent, and attach it. The
 * caller holds the inbox lock. Throws only if creation itself fails; if attaching
 * fails afterward, the inbox is deleted again so an empty one doesn't hold the name.
 */
async function createAndAttachInbox(instance: string): Promise<ActionResult> {
  const inboxId = await createApiInbox(instance)
  const warnings: string[] = []

  try {
    const agents = await listAgents()
    if (agents.length > 0) await addInboxMembers(inboxId, agents.map((agent) => agent.id))
  } catch {
    warnings.push(
      'The agents could not be added to the new inbox — add them in Chatwoot under ' +
        'Settings → Inboxes → Collaborators, or only administrators will see its conversations.',
    )
  }

  const attached = await attachInbox(instance, inboxId)
  if (!attached.ok) {
    const removed = await deleteInbox(inboxId).then(
      () => true,
      () => false,
    )
    return {
      ok: false,
      error:
        `${attached.error ?? 'The inbox could not be attached.'}` +
        (removed
          ? ''
          : ` Inbox #${inboxId} was created but could not be removed again — delete it in Chatwoot, or its name stays taken.`),
    }
  }

  if (attached.warning) warnings.push(attached.warning)
  return warnings.length > 0 ? { ok: true, warning: warnings.join(' ') } : { ok: true }
}

// --- the Funnel's copy -------------------------------------------------------

/**
 * Bring the Funnel's copy up to date now, within a button's time budget. Partial
 * progress is not failure — only a run that could not proceed at all is an error.
 */
export async function syncFunnelNow(): Promise<ActionResult> {
  await requireUser()
  try {
    const report = await syncFunnelSources({ force: true, pageBudget: 30, budgetMs: 50_000 })
    revalidatePath('/funnel')
    // What failed is said in plain words on the screen; the detail — a status
    // code, a timeout, a missing setting — is for the log.
    const sources = [
      ['conversations', report.conversations, 'Conversations could not be refreshed'],
    ] as const
    const problems: string[] = []
    for (const [source, outcome, sentence] of sources) {
      if (outcome.status === SourceStatus.Failed || outcome.status === SourceStatus.Unavailable) {
        console.warn(`[panel] ${source} refresh ${outcome.status}:`, outcome.detail ?? '')
        problems.push(sentence)
      }
    }
    if (problems.length === sources.length) return { ok: false, error: problems.join('; ') }
    return problems.length > 0 ? { ok: true, warning: problems.join('; ') } : { ok: true }
  } catch (error) {
    console.warn('[panel] funnel refresh failed:', error instanceof Error ? error.message : error)
    return { ok: false, error: 'The data could not be refreshed' }
  }
}

/**
 * Read every conversation from Chatwoot again, keeping what is held meanwhile.
 * Starts the walk and takes its first stretch here.
 */
export async function rebuildFunnelHistory(): Promise<ActionResult> {
  await requireUser()
  try {
    await requestRebuild()
    return await syncFunnelNow()
  } catch (error) {
    return failure(error, 'The history could not be rebuilt')
  }
}
