'use client'

// framework
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

// lib
import { checkLineName, createLine } from '@/app/actions'
import { unhideLine } from '@/lib/line-deletes'

// components
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Icon } from '../ui/icons'
import { Toasts } from '../ui/Toast'

// Long enough that the check runs on a pause, not on every keystroke.
const CHECK_DELAY_MS = 350
const NAME_SHAPE = /^[a-zA-Z0-9._-]+$/
const NAME_SHAPE_HELP = 'Use letters, numbers, dots, dashes and underscores only — no spaces.'

// `unchecked` is a check that could not run. It does not block Create: the
// server checks the name again before creating anything.
type NameCheck = {
  name: string
  status: 'checking' | 'ok' | 'taken' | 'unchecked'
  message?: string
} | null

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="bg-accent-soft text-accent tnum inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
        {n}
      </span>
      {children}
    </li>
  )
}

export function AddLine({ suggestion }: { suggestion: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(suggestion)
  const [withInbox, setWithInbox] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [check, setCheck] = useState<NameCheck>(null)
  const [toast, setToast] = useState<string | null>(null)

  const trimmed = name.trim()
  const canCreate =
    check?.name === trimmed && (check.status === 'ok' || check.status === 'unchecked')

  // Checked as soon as the dialog opens and on every pause in typing, so a taken
  // suggested name is caught before Create rather than after.
  useEffect(() => {
    if (!open) return
    if (!trimmed) {
      setCheck(null)
      return
    }
    if (!NAME_SHAPE.test(trimmed)) {
      setCheck({ name: trimmed, status: 'taken', message: NAME_SHAPE_HELP })
      return
    }

    setCheck({ name: trimmed, status: 'checking' })
    let stale = false
    const timer = setTimeout(() => {
      checkLineName(trimmed)
        .then((result) => {
          if (stale) return
          setCheck(
            result.ok
              ? { name: trimmed, status: 'ok' }
              : { name: trimmed, status: 'taken', message: result.error },
          )
        })
        .catch(() => {
          if (!stale) setCheck({ name: trimmed, status: 'unchecked' })
        })
    }, CHECK_DELAY_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [open, trimmed])

  function openDialog() {
    // A fresh suggestion every time: after a line is created, the name last typed
    // here is exactly the one that is now taken.
    setName(suggestion)
    setError(null)
    setCheck(null)
    setOpen(true)
  }

  async function submit() {
    setBusy(true)
    setError(null)
    const result = await createLine(trimmed, withInbox)
    setBusy(false)
    if (result.ok) {
      // A line deleted earlier in this tab under the same name is still hidden.
      unhideLine(trimmed)
      setOpen(false)
      router.refresh()
      // The new line appearing on the page is the success message. A warning —
      // the line exists but its inbox does not — outlives the dialog as a toast.
      if (result.warning) setToast(result.warning)
    } else {
      setError(result.error ?? 'Could not create the line')
    }
  }

  return (
    <>
      <Button variant="primary" onClick={openDialog}>
        <Icon.Plus className="h-4 w-4" />
        Add line
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add a line"
        description={
          withInbox
            ? 'Creates the line and a Chatwoot inbox with the same name, already connected to it. Connecting the phone is the next step.'
            : 'Creates the line. Connecting the phone is the next step.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} disabled={!canCreate} onClick={() => void submit()}>
              Create
            </Button>
          </>
        }
      >
        <label className="block text-sm">
          <span className="text-fg font-semibold">Line name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={check?.status === 'taken' || undefined}
            aria-describedby="line-name-status line-name-help"
            className="input tnum mt-1.5"
          />
          <span
            id="line-name-status"
            aria-live="polite"
            className={`mt-1.5 block min-h-4 text-xs font-medium ${
              check?.status === 'taken'
                ? 'text-danger'
                : check?.status === 'ok'
                  ? 'text-good'
                  : 'text-muted'
            }`}
          >
            {check?.status === 'checking' && 'Checking the name…'}
            {check?.status === 'taken' && check.message}
            {check?.status === 'ok' && 'Available'}
          </span>
          <span id="line-name-help" className="mt-1 block text-xs text-muted">
            Letters, numbers, dots, dashes and underscores. No spaces — the name becomes part of the
            webhook address. Name it after the line, not the person holding the phone.
          </span>
        </label>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={withInbox}
            onChange={(event) => setWithInbox(event.target.checked)}
            className="check mt-0.5"
          />
          <span>
            <span className="text-fg font-semibold">Also create a Chatwoot inbox</span>
            <span className="mt-0.5 block text-xs text-muted">
              Named “{trimmed || '…'}”, with every agent added. If the inbox cannot be made — say
              Chatwoot already has one with this name — the line is still created and you are told.
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-danger mt-3 text-sm">
            {error}
          </p>
        )}

        {/* What is left after Create. Saying so up front prevents a line that
            looks healthy on this screen but silently drops every message. */}
        <ol className="mt-5 space-y-2.5 border-t border-line pt-4 text-xs font-medium text-muted">
          {withInbox ? (
            <>
              <Step n={1}>Create the line and its Chatwoot inbox here</Step>
              <Step n={2}>Scan the QR with the phone</Step>
            </>
          ) : (
            <>
              <Step n={1}>Create the line here</Step>
              <Step n={2}>Scan the QR with the phone</Step>
              <Step n={3}>Attach an inbox to the line with “Assign inbox” so its messages start flowing</Step>
            </>
          )}
        </ol>
      </Dialog>

      <Toasts items={toast ? [{ id: 1, message: toast }] : []} onDismiss={() => setToast(null)} />
    </>
  )
}
