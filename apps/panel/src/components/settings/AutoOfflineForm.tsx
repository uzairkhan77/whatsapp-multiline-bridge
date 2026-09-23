"use client";

// framework
import { useRouter } from "next/navigation";
import { useState } from "react";

// enums
import { DateStyle } from "@/enums/date-style";

// types
import type {
  AutoOfflineEventView,
  AutoOfflineView,
} from "@/types/settings-view";

// lib
import { saveAutoOfflineSettings } from "@/app/actions";

// components
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { LocalDate } from "@/components/ui/LocalDate";

const DEFAULTS: AutoOfflineView = { enabled: false, thresholdMinutes: 30 };

/**
 * When agents are set Offline automatically. Applies to every agent on the
 * account, whoever is handling which conversation.
 */
export function AutoOfflineForm({
  initial,
  events,
}: {
  initial: AutoOfflineView | null;
  events: AutoOfflineEventView[];
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState((initial ?? DEFAULTS).enabled);
  // Held as text, not a number. A number input that is briefly empty while
  // somebody retypes it would otherwise snap to 0 or NaN under their cursor.
  const [minutes, setMinutes] = useState(
    String((initial ?? DEFAULTS).thresholdMinutes),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await saveAutoOfflineSettings({
      enabled,
      thresholdMinutes: Number(minutes),
    });
    setBusy(false);
    if (result.ok) {
      setNotice("Saved. Changes take effect within 30 seconds.");
      router.refresh();
    } else {
      setError(result.error ?? "Could not save the availability settings");
    }
  }

  return (
    <form
      className="card flex flex-col gap-5 p-5 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex items-start gap-3">
        <span className="icon-tile bg-accent-soft text-accent">
          <Icon.Clock className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Availability</h2>
          <p className="mt-0.5 text-sm text-muted">
            An agent who forgets to go Offline keeps receiving new customers.
            This sets them Offline once they have plainly stopped working.
          </p>
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-line p-3.5 transition-colors duration-150 hover:bg-surface-2/60">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="check mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            Set inactive agents Offline automatically
          </span>
          <span className="block text-xs text-muted">
            Applies to every agent on the account, with no exceptions. Off means
            nobody is ever set Offline by this system.
          </span>
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <label htmlFor="auto-offline-minutes" className="text-sm font-medium">
          Limit
        </label>
        <div className="flex items-center gap-2">
          <input
            id="auto-offline-minutes"
            type="number"
            min={1}
            max={1440}
            step={1}
            inputMode="numeric"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            className="input w-28"
          />
          <span className="text-sm text-muted">minutes</span>
        </div>

        {/* The full rule, since "30 minutes" alone reads as "logs everyone out
            every half hour" — that is not what this does. */}
        <div className="rounded-xl border border-line bg-surface-2/40 p-3.5 text-xs text-muted">
          <p className="font-medium text-fg">
            An agent is set Offline only when all three are true:
          </p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4">
            <li>
              They are Online or Busy — both still receive new customers here.
            </li>
            <li>They have sent nothing at all for longer than the limit.</li>
            <li>
              A customer assigned to them has been waiting longer than the limit
              for a reply.
            </li>
          </ul>
          <p className="mt-2">
            An agent having a quiet spell with nobody waiting is left alone, and
            so is one who is replying to other customers. Going Offline is the
            only change: conversations already assigned stay with them, and they
            are not signed out of Chatwoot. They can set themselves back Online
            at any time.
          </p>
          <p className="mt-2">
            Each time this happens, the agent is emailed to say so, naming the
            customer who was waiting. Only the agent receives it.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Recently set Offline</span>

        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">
            {enabled
              ? "Nobody has been set Offline by this rule yet."
              : "Nothing to show — this is switched off."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
            {events.map((event, index) => (
              <li
                key={`${event.at}-${index}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2.5 text-sm"
              >
                <span className="font-medium">{event.agent}</span>
                <span className="text-muted">
                  {event.waitedMinutes === null
                    ? "set Offline"
                    : `set Offline after a customer waited ${event.waitedMinutes} min`}
                  {event.conversationId !== null &&
                    ` on conversation #${event.conversationId}`}
                </span>
                <LocalDate
                  iso={event.at}
                  style={DateStyle.DateTime}
                  className="ml-auto shrink-0 text-xs text-muted-2"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="callout callout-danger">
          <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {notice && (
        <p role="status" className="callout callout-good">
          <Icon.Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </p>
      )}

      <div className="flex justify-end border-t border-line pt-4">
        <Button type="submit" variant="primary" busy={busy}>
          Save availability settings
        </Button>
      </div>
    </form>
  );
}
