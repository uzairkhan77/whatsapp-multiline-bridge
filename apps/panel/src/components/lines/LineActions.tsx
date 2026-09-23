'use client'

// framework
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

// enums
import { LineHealth } from '@/enums/line-health'
import { QrFailure } from '@/enums/qr-failure'

// lib
import {
  assignInbox,
  checkState,
  createInboxForLine,
  detachInbox,
  listChatwootInboxes,
  logoutLine,
  requestQr,
  type InboxOption,
} from '@/app/actions'
import { deleteInBackground } from '@/lib/line-deletes'

// components
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Icon } from '../ui/icons'

// The gateway rotates a QR about every 30 seconds. Fetch a new one a little inside
// that, or the operator is holding a phone up to a code that already expired.
const QR_REFRESH_MS = 25_000
const STATE_POLL_MS = 3_000

// QR expiry and reconnect rejection have to be handled here. Six unscanned
// codes (~2.5 min) stops the polling rather than hammering an abandoned tab forever.
const MAX_QR_REFRESHES = 6
// Consecutive failed QR requests before the sheet gives up on the gateway.
const MAX_QR_FAILURES = 3

type Mode = null | 'qr' | 'logout' | 'delete' | 'assign' | 'detach'

export function LineActions({
  instance,
  health,
  currentInboxId = null,
}: {
  instance: string
  health: LineHealth
  /** The Chatwoot inbox this line feeds today, if any — preselected in the picker. */
  currentInboxId?: number | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [scanned, setScanned] = useState(false)
  const [inboxes, setInboxes] = useState<InboxOption[] | null>(null)
  const [chosenInbox, setChosenInbox] = useState<number | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [failure, setFailure] = useState<QrFailure | null>(null)
  // Bumped by "Try again": the QR effect below depends on it, so incrementing it
  // tears the old timers down and starts a fresh cycle with fresh counters.
  const [attempt, setAttempt] = useState(0)

  const close = useCallback(() => {
    setMode(null)
    setError(null)
    setQr(null)
    setPairingCode(null)
    setConfirmText('')
    setScanned(false)
    setInboxes(null)
    setChosenInbox(null)
    setWarning(null)
    setFailure(null)
  }, [])

  const retryQr = useCallback(() => {
    setError(null)
    setFailure(null)
    setQr(null)
    setPairingCode(null)
    setAttempt((n) => n + 1)
  }, [])

  // Two timers while the QR sheet is open: one refreshes the code, the other polls
  // for the scan. Both stop the moment the dialog closes or on failure — a poll left
  // running against a closed sheet is how an idle tab hammers the gateway.
  const scannedRef = useRef(false)
  useEffect(() => {
    if (mode !== 'qr') return
    scannedRef.current = false

    let stopped = false
    let refreshes = 0
    let consecutiveFailures = 0
    // The gateway reports `connecting` while a code is up, and drops to `close` if
    // WhatsApp refuses the link. A `close` before any `connecting` is just the
    // line's starting state, not a rejection.
    let sawConnecting = false

    const stop = () => {
      stopped = true
      clearInterval(refresh)
      clearInterval(poll)
    }
    const fail = (why: QrFailure) => {
      stop()
      setFailure(why)
    }

    const fetchQr = async () => {
      const result = await requestQr(instance)
      if (stopped) return
      if ('base64' in result && result.ok) {
        consecutiveFailures = 0
        setQr(result.base64)
        setPairingCode(result.pairingCode)
        setError(null)
      } else {
        consecutiveFailures += 1
        setError(('error' in result && result.error) || 'Could not request a QR code')
        if (consecutiveFailures >= MAX_QR_FAILURES) fail(QrFailure.Unreachable)
      }
    }

    void fetchQr()
    const refresh = setInterval(() => {
      if (scannedRef.current) return
      refreshes += 1
      if (refreshes >= MAX_QR_REFRESHES) {
        fail(QrFailure.Expired)
        return
      }
      void fetchQr()
    }, QR_REFRESH_MS)

    const poll = setInterval(async () => {
      const { state } = await checkState(instance)
      if (stopped) return
      if (state === 'open') {
        scannedRef.current = true
        setScanned(true)
        stop()
        router.refresh()
        setTimeout(close, 1400)
      } else if (state === 'connecting') {
        sawConnecting = true
      } else if (state === 'close' && sawConnecting) {
        fail(QrFailure.Rejected)
      }
    }, STATE_POLL_MS)

    return stop
  }, [mode, attempt, instance, router, close])

  // Fetched when the picker opens, not when the page loads: the inbox list is a
  // Chatwoot API call, and most visits to this page never open the picker.
  useEffect(() => {
    if (mode !== 'assign') return
    setChosenInbox(currentInboxId)
    void listChatwootInboxes().then((result) => {
      if ('inboxes' in result) setInboxes(result.inboxes)
      else setError(result.error ?? 'Could not load the inboxes from Chatwoot')
    })
  }, [mode, currentInboxId])

  async function run(action: () => Promise<{ ok: boolean; error?: string; warning?: string }>) {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (result.ok && result.warning) {
      // The action worked but left a follow-up in the person's hands. Closing the
      // dialog would take the instructions away at the exact moment they matter.
      router.refresh()
      setWarning(result.warning)
    } else if (result.ok) {
      router.refresh()
      close()
    } else {
      setError(result.error ?? 'That did not work')
    }
  }

  // Optimistic: the line is gone the moment the delete is confirmed, and the real
  // delete finishes behind it. If that fails, the line comes back with a toast
  // saying why — see lib/line-deletes.
  function remove() {
    close()
    deleteInBackground(instance)
    // On the line's own page there is nothing left to show — go back to the list.
    if (pathname.startsWith('/lines/')) router.replace('/')
  }

  const connected = health === LineHealth.Up

  // Mirrors the server's rule (inboxNameKey) so the Create button can say "taken"
  // before the click. The server checks again under a lock — this is a hint only.
  const nameKey = instance.trim().toLowerCase()
  const sameName = inboxes?.find((inbox) => inbox.name.trim().toLowerCase() === nameKey) ?? null

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!connected && (
          <Button variant="primary" onClick={() => setMode('qr')}>
            <Icon.Qr className="h-4 w-4" />
            {health === LineHealth.Connecting ? 'Show QR' : health === LineHealth.Down ? 'Reconnect' : 'Connect'}
          </Button>
        )}
        {connected && (
          <Button variant="neutral" onClick={() => setMode('logout')}>
            <Icon.Logout className="h-4 w-4" />
            Log out
          </Button>
        )}
        {/* Primary when nothing is assigned: an unrouted line drops everything it
            receives, so this is the one action that matters on it. */}
        <Button
          variant={currentInboxId === null ? 'primary' : 'ghost'}
          onClick={() => setMode('assign')}
        >
          <Icon.Chat className="h-4 w-4" />
          {currentInboxId === null ? 'Assign inbox' : 'Change inbox'}
        </Button>
        <Button variant="ghost" onClick={() => setMode('delete')} aria-label={`Delete ${instance}`}>
          <Icon.Trash className="h-4 w-4" />
          Delete
        </Button>
      </div>

      <Dialog
        open={mode === 'assign'}
        onClose={close}
        title={`Which inbox should ${instance} feed?`}
        description="Every message this number receives is created in the chosen Chatwoot inbox, and replies from that inbox go out through this number."
        footer={
          warning ? (
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              {currentInboxId !== null && (
                <Button
                  variant="ghost"
                  className="text-danger mr-auto"
                  disabled={busy}
                  onClick={() => {
                    setError(null)
                    setMode('detach')
                  }}
                >
                  Detach
                </Button>
              )}
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={chosenInbox === null || chosenInbox === currentInboxId}
                onClick={() => void run(() => assignInbox(instance, chosenInbox!))}
              >
                {currentInboxId === null ? 'Assign inbox' : 'Change inbox'}
              </Button>
            </>
          )
        }
      >
        {warning ? (
          <p
            role="alert"
            className="callout callout-warn"
          >
            <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{warning}</span>
          </p>
        ) : inboxes === null && !error ? (
          <div className="skeleton h-24" role="status" aria-label="Loading inboxes" />
        ) : inboxes ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line p-3">
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-medium">
                  A new inbox named <span className="tnum">“{instance}”</span>
                </span>
                <span className="block text-xs text-muted">
                  {sameName
                    ? `Chatwoot already has an inbox with this name (#${sameName.id}), and names are never repeated — pick it below instead.`
                    : 'Created in Chatwoot with every agent added, then attached here.'}
                </span>
              </span>
              <Button
                variant="neutral"
                busy={busy}
                disabled={sameName !== null}
                onClick={() => void run(() => createInboxForLine(instance))}
              >
                <Icon.Plus className="h-4 w-4" />
                Create
              </Button>
            </div>
            {inboxes.length === 0 ? (
              <p className="text-sm text-muted">The Chatwoot account has no other inboxes yet.</p>
            ) : (
              <div role="radiogroup" aria-label="Chatwoot inboxes" className="flex flex-col gap-1.5">
                {inboxes.map((inbox) => {
                  // Taken by another line: disabling here just previews the DB constraint.
                  // Wrong channel type: the bridge only delivers into (and configures
                  // webhooks on) API-channel inboxes — anything else would route nothing.
                  const taken = inbox.assignedTo !== null && inbox.assignedTo !== instance
                  const wrongType = inbox.channelType !== 'Channel::Api'
                  const disabled = taken || wrongType
                  const selected = chosenInbox === inbox.id
                  return (
                    <label
                      key={inbox.id}
                      className={`flex items-center gap-3 rounded-xl border p-3 transition-colors duration-150 ${
                        disabled
                          ? 'cursor-not-allowed border-line opacity-45'
                          : selected
                            ? 'bg-accent-soft border-accent/40 cursor-pointer'
                            : 'hover:bg-surface-2 cursor-pointer border-line'
                      }`}
                    >
                      <input
                        type="radio"
                        name="inbox"
                        checked={selected}
                        disabled={disabled}
                        onChange={() => setChosenInbox(inbox.id)}
                        className="check"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{inbox.name}</span>
                        <span className="tnum block text-xs text-muted">
                          #{inbox.id} · {inbox.channelType.replace('Channel::', '')}
                          {taken && ` · feeds ${inbox.assignedTo}`}
                          {!taken && wrongType && ' · not an API inbox — messages cannot be delivered into it'}
                          {inbox.assignedTo === instance && ' · current'}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </>
        ) : null}
        {error && <p className="text-danger mt-3 text-sm">{error}</p>}
        {!warning && (
          <p className="mt-4 text-xs text-muted">
            Routing starts within 30 seconds, and the inbox&apos;s reply webhook is configured in
            Chatwoot automatically — nothing to paste anywhere.
          </p>
        )}
      </Dialog>

      <Dialog
        open={mode === 'detach'}
        onClose={close}
        title={`Detach the inbox from ${instance}?`}
        description="The inbox and all its conversations stay in Chatwoot. Only the connection to this number is removed, and it can be attached again at any time."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" busy={busy} onClick={() => void run(() => detachInbox(instance))}>
              Detach inbox
            </Button>
          </>
        }
      >
        {error && <p className="text-danger mb-3 text-sm">{error}</p>}
        <p className="callout callout-warn">
          <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Within 30 seconds, messages this number receives stop reaching Chatwoot and are dropped,
            and replies from the inbox stop going out. Use “Assign inbox” to attach one again.
          </span>
        </p>
      </Dialog>

      <Dialog
        open={mode === 'qr'}
        onClose={close}
        title={`${health === LineHealth.Down ? 'Reconnect' : 'Connect'} ${instance}`}
        description="Open WhatsApp on the phone, then Settings → Linked devices → Link a device."
      >
        <div className="flex flex-col items-center gap-4">
          {scanned ? (
            <div className="flex flex-col items-center gap-2 py-10">
              <span className="icon-tile bg-good-soft text-good h-16 w-16 rounded-2xl">
                <Icon.Connected className="h-8 w-8" />
              </span>
              <p className="text-good font-medium">Connected</p>
              <p className="text-sm text-muted">This line is live again.</p>
            </div>
          ) : failure ? (
            // The sheet stopped on its own — said plainly, with the way forward, since a
            // dropped line means the business is mid-incident.
            <div role="alert" className="flex w-full flex-col items-center gap-2 py-6 text-center">
              <span className="icon-tile bg-danger-soft text-danger h-16 w-16 rounded-2xl">
                <Icon.Disconnected className="h-8 w-8" />
              </span>
              <p className="text-danger font-medium">
                {failure === QrFailure.Expired && 'The code kept expiring'}
                {failure === QrFailure.Rejected && 'WhatsApp did not accept the link'}
                {failure === QrFailure.Unreachable && 'No code could be issued'}
              </p>
              <p className="max-w-sm text-sm text-muted">
                {failure === QrFailure.Expired &&
                  `${MAX_QR_REFRESHES} codes went unscanned, so this sheet stopped asking for new ones. ` +
                    'Have the phone ready on the Link a device screen, then try again.'}
                {failure === QrFailure.Rejected &&
                  'The phone declined the link, or the number is already linked to as many devices as WhatsApp allows. ' +
                    'Check Linked devices on the phone, then try again with a fresh code.'}
                {failure === QrFailure.Unreachable &&
                  'The WhatsApp connection service did not answer after several tries, so the line cannot be reconnected right now.'}
              </p>
              {failure === QrFailure.Unreachable && error && (
                <p className="tnum max-w-sm text-xs text-muted">{error}</p>
              )}
              <Button variant="primary" className="mt-2" onClick={retryQr}>
                <Icon.Refresh className="h-4 w-4" />
                Try again
              </Button>
            </div>
          ) : error ? (
            <div className="w-full">
              <p className="text-danger text-sm">{error}</p>
              <p className="mt-1 text-xs text-muted">Retrying automatically.</p>
              <Button variant="neutral" className="mt-3" onClick={retryQr}>
                <Icon.Refresh className="h-4 w-4" />
                Try again now
              </Button>
            </div>
          ) : qr ? (
            <>
              {/* White plate with a soft ring behind the code: a QR needs a quiet zone
                  of contrast around it, and the ring marks it as the thing to scan. */}
              <div className="rounded-2xl bg-white p-3 shadow-[var(--shadow-card)] ring-1 ring-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt={`QR code to link ${instance} to WhatsApp`}
                  width={232}
                  height={232}
                  className="block h-[232px] w-[232px]"
                />
              </div>
              <p className="text-center text-xs text-muted">
                The code refreshes every 25 seconds and this sheet closes itself once the phone
                has scanned it. If nothing is scanned after a few minutes it stops and says so.
              </p>
              {pairingCode && (
                <p className="text-sm text-muted">
                  Or enter the code{' '}
                  <span className="tnum text-fg tracking-widest">{pairingCode}</span>
                </p>
              )}
            </>
          ) : (
            // Reserved at the QR's exact size, so the sheet does not jump when the
            // image arrives.
            <div className="skeleton h-[256px] w-[256px] rounded-2xl" aria-label="Loading QR code" role="status" />
          )}
        </div>
      </Dialog>

      <Dialog
        open={mode === 'logout'}
        onClose={close}
        title={`Log ${instance} out?`}
        description="The number stops sending and receiving immediately. Reconnecting needs a fresh QR scan on the phone."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" busy={busy} onClick={() => void run(() => logoutLine(instance))}>
              Log out
            </Button>
          </>
        }
      >
        {error && <p className="text-danger text-sm">{error}</p>}
        <p className="text-sm text-muted">
          Customers messaging this number will not get a reply until it is reconnected.
        </p>
      </Dialog>

      <Dialog
        open={mode === 'delete'}
        onClose={close}
        title={`Delete ${instance}?`}
        description="This removes the line and its stored WhatsApp session. It cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={busy}
              disabled={confirmText !== instance}
              onClick={remove}
            >
              Delete this line
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          The session keys are deleted with it, so this number can only come back by scanning a new
          QR. Its inbox assignment is removed too, freeing that inbox for another line.
          Conversations already in Chatwoot are unaffected.
        </p>
        <label className="mt-4 block text-sm">
          <span className="text-fg">
            Type <span className="tnum">{instance}</span> to confirm
          </span>
          <input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="input tnum mt-1.5"
          />
        </label>
        {error && <p className="text-danger mt-3 text-sm">{error}</p>}
      </Dialog>
    </>
  )
}
