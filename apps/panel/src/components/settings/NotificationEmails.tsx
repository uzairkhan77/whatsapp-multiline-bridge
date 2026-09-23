"use client";

// framework
import { useRouter } from "next/navigation";
import { useState } from "react";

// lib
import {
  addNotificationEmail,
  removeNotificationEmail,
  sendTestEmail,
} from "@/app/actions";

// components
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";

const field = "input";

/**
 * The list is server-rendered truth passed as a prop; this component only fires
 * the actions and refreshes, so concurrent edits converge on the database.
 */
export function NotificationEmails({ emails }: { emails: string[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await addNotificationEmail(draft);
    setBusy(false);
    if (result.ok) {
      setDraft("");
      router.refresh();
    } else {
      setError(result.error ?? "Could not add the email address");
    }
  }

  async function remove(email: string) {
    setError(null);
    setNotice(null);
    const result = await removeNotificationEmail(email);
    if (result.ok) router.refresh();
    else setError(result.error ?? "Could not remove the email address");
  }

  // A real send to the real list. Alert email fails invisibly otherwise: the
  // addresses look fine on this screen, and the truth only comes out on the day
  // a line drops and nothing arrives.
  async function test() {
    setTesting(true);
    setError(null);
    setNotice(null);
    const result = await sendTestEmail();
    setTesting(false);
    if (result.ok)
      setNotice(
        "Test email sent — check the inboxes above (and their spam folders).",
      );
    else setError(result.error ?? "The test send failed");
  }

  return (
    <div
      className="card reveal flex flex-col gap-4 p-5 sm:p-6"
      style={{ ["--i" as string]: 0 }}
    >
      <div className="flex items-start gap-3">
        <span className="icon-tile bg-accent-soft text-accent">
          <Icon.Users className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Alert recipients</h2>
          <p className="mt-0.5 text-sm text-muted">
            Who should be emailed when something needs a person — a line
            dropping, a failed delivery. The addresses are stored now; the
            alerts themselves arrive with the monitoring work, so nothing is
            sent to them yet.
          </p>
        </div>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          type="email"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="name@company.com"
          aria-label="Email address to add"
          className={`${field} min-w-0 flex-1`}
        />
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={!draft.trim()}
          className="shrink-0"
        >
          <Icon.Plus className="h-4 w-4" />
          Add
        </Button>
      </form>

      {error && (
        <p role="alert" className="callout callout-danger">
          <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {emails.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
          No recipients yet — when alerting goes live, it will have nobody to
          tell.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {emails.map((email) => (
            <li
              key={email}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 py-1.5 pr-1.5 pl-2.5 transition-colors duration-150 hover:bg-surface-2"
            >
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"
                aria-hidden="true"
              >
                <Icon.Mail className="h-3.5 w-3.5" />
              </span>
              <span className="tnum min-w-0 flex-1 truncate text-sm">
                {email}
              </span>
              <Button
                variant="ghost"
                className="min-h-8 px-2 py-1"
                onClick={() => void remove(email)}
                aria-label={`Remove ${email}`}
              >
                <Icon.Close className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <Button
          variant="neutral"
          busy={testing}
          disabled={emails.length === 0}
          onClick={() => void test()}
        >
          Send test email
        </Button>
      </div>
    </div>
  );
}
