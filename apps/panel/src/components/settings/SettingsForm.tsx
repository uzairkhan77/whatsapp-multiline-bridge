'use client'

// framework
import { useRouter } from 'next/navigation'
import { useState } from 'react'

// types
import type { SettingsView } from '@/types/settings-view'

// lib
import { getWebhookUrl, saveChatwootSettings } from '@/app/actions'

// components
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/icons'
import { PasswordInput } from '@/components/ui/PasswordInput'

// Re-exported: app/(app)/settings/page.tsx still imports its own copy from here.
export type { SettingsView } from '@/types/settings-view'

const field = 'input'

function SecretField({
  label,
  name,
  last4,
  value,
  onChange,
  help,
}: {
  label: string
  name: string
  last4: string | null
  value: string
  onChange: (next: string) => void
  help: string
}) {
  return (
    // htmlFor, not a wrapping <label> — see the caution in PasswordInput.
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <PasswordInput
        id={name}
        name={name}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={last4 ? `Unchanged — ends in ····${last4}` : 'Required'}
      />
      <span className="text-xs text-muted">{help}</span>
    </div>
  )
}

export function SettingsForm({ initial }: { initial: SettingsView }) {
  const router = useRouter()
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [accountId, setAccountId] = useState(initial.accountId)
  const [apiToken, setApiToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)

  // The webhook URL is fetched on click, never rendered into the page — it
  // carries the secret. See getWebhookUrl in app/actions.ts.
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null)
  const [webhookError, setWebhookError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    setWarning(null)
    const result = await saveChatwootSettings({ baseUrl, accountId, apiToken, webhookSecret })
    setBusy(false)
    if (result.ok && result.warning) {
      setApiToken('')
      setWebhookSecret('')
      setWarning(result.warning)
      setWebhookUrl(null)
      router.refresh()
    } else if (result.ok) {
      // Cleared deliberately: holding them afterwards would put a live secret
      // back into page state that is designed to keep it out.
      setApiToken('')
      setWebhookSecret('')
      setSaved(true)
      setWebhookUrl(null)
      router.refresh()
    } else {
      setError(result.error ?? 'Could not save the settings')
    }
  }

  async function reveal() {
    setWebhookError(null)
    const result = await getWebhookUrl()
    if ('url' in result) setWebhookUrl(result.url)
    else setWebhookError(result.error ?? 'Could not build the webhook URL')
  }

  return (
    <div className="flex flex-col gap-gutter">
      {initial.source === 'env' && (
        <p className="callout callout-warn reveal" style={{ ['--i' as string]: 0 }}>
          <Icon.Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            These values are being read from environment variables — nothing is saved in the
            database yet. Saving here moves them into it, after which this screen is the only
            place they are edited.
          </span>
        </p>
      )}

      <form
        className="card reveal flex flex-col gap-4 p-5 sm:p-6"
        style={{ ['--i' as string]: 1 }}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex items-start gap-3">
          <span className="icon-tile bg-accent-soft text-accent">
            <Icon.Chat className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Chatwoot</h2>
            <p className="mt-0.5 text-sm text-muted">The account lines deliver into.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Chatwoot address</span>
            <input
              name="baseUrl"
              type="url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://app.chatwoot.com"
              className={field}
            />
            <span className="text-xs text-muted">
              Chatwoot Cloud is https://app.chatwoot.com — only a self-hosted install differs.
            </span>
          </label>

          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium">Account ID</span>
            <input
              name="accountId"
              inputMode="numeric"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              placeholder="176232"
              className={`${field} tnum`}
              required
            />
            <span className="text-xs text-muted [overflow-wrap:anywhere]">
              The number in your Chatwoot URL: app.chatwoot.com/app/accounts/<b>this</b>/…
            </span>
          </label>
        </div>

        <SecretField
          label="API access token"
          name="apiToken"
          last4={initial.apiTokenLast4}
          value={apiToken}
          onChange={setApiToken}
          help="Chatwoot → Profile Settings → Access Token. Leave blank to keep the current one."
        />

        <SecretField
          label="Webhook secret"
          name="webhookSecret"
          last4={initial.webhookSecretLast4}
          value={webhookSecret}
          onChange={setWebhookSecret}
          help="Any long random string; it must match the secret in the webhook URL below. Leave blank to keep the current one."
        />

        {error && (
          <p role="alert" className="callout callout-danger">
            <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        {saved && (
          <p role="status" className="callout callout-good">
            <Icon.Check className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Saved. Changes take effect within 30 seconds. A changed webhook secret is pushed to
              every connected inbox automatically.
            </span>
          </p>
        )}
        {warning && (
          <p role="alert" className="callout callout-warn">
            <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{warning}</span>
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          <Button type="submit" variant="primary" busy={busy}>
            Save settings
          </Button>
        </div>
      </form>

      <section
        aria-label="Webhook"
        className="card reveal flex flex-col gap-4 p-5 sm:p-6"
        style={{ ['--i' as string]: 2 }}
      >
        <div className="flex items-start gap-3">
          <span className="icon-tile bg-surface-2 text-muted">
            <Icon.Link className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Chatwoot reply webhook</h2>
            <p className="mt-0.5 text-sm text-muted">
              Chatwoot has to be told where to send agent replies. This happens automatically —
              assigning an inbox writes the address into its Chatwoot configuration, and rotating
              the secret above rewrites it on every connected inbox. The address is shown here for
              the rare case where that automatic write fails, or an inbox is set up by hand. It
              includes the webhook secret, so it is only shown on request.
            </p>
          </div>
        </div>

        {webhookUrl ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="tnum min-w-0 flex-1 rounded-xl border border-line bg-surface-2 p-3 text-xs break-all">
              {webhookUrl}
            </code>
            <Button
              variant="neutral"
              onClick={() => void navigator.clipboard?.writeText(webhookUrl)}
            >
              <Icon.Copy className="h-4 w-4" />
              Copy
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="neutral" onClick={() => void reveal()}>
              <Icon.Eye className="h-4 w-4" />
              Show webhook URL
            </Button>
          </div>
        )}
        {webhookError && (
          <p className="callout callout-danger">
            <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{webhookError}</span>
          </p>
        )}
      </section>
    </div>
  )
}
