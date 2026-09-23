// framework
import type { Metadata } from "next";

// lib
import { requireUser } from "@/lib/auth";
import {
  getAutoOfflineSettings,
  getChatwootSettings,
  last4,
  listNotificationEmails,
  listRecentAutoOfflineEvents,
} from "@/lib/settings";

// components
import { PageHeader } from "@/components/layout/PageHeader";
import type { SettingsView } from "@/components/settings/SettingsForm";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

export const metadata: Metadata = { title: "Settings" };

// Settings are live operational state, same as line status: a cached copy of an
// already-rotated token would tell whoever rotated it that nothing happened.
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();

  // A DB read failure lands here as an unconfigured screen rather than an error
  // page, which is right: the one thing someone on this screen wants to do —
  // enter the settings — still works.
  const settings = await getChatwootSettings().catch(() => null);
  const emails = await listNotificationEmails().catch(() => []);
  const autoOffline = await getAutoOfflineSettings().catch(() => null);
  const offlineEvents = await listRecentAutoOfflineEvents().catch(() => []);

  // Only what the form needs crosses to the browser. The token and secret go as
  // their last four characters — enough to confirm which value is stored, not
  // enough to use.
  const view: SettingsView = settings
    ? {
        baseUrl: settings.baseUrl,
        accountId: settings.accountId,
        apiTokenLast4: settings.apiToken ? last4(settings.apiToken) : null,
        webhookSecretLast4: settings.webhookSecret
          ? last4(settings.webhookSecret)
          : null,
        source: settings.source,
      }
    : {
        baseUrl: "https://app.chatwoot.com",
        accountId: "",
        apiTokenLast4: null,
        webhookSecretLast4: null,
        source: null,
      };

  // Times cross as ISO strings so LocalDate can render them in the reader's own
  // timezone — a Date sent straight to a client component would be formatted in
  // the server's, which on Vercel is UTC.
  const offlineEventViews = offlineEvents.map((event) => ({
    agent: event.agentName || event.agentEmail || "Unknown agent",
    conversationId: event.conversationId,
    waitedMinutes: event.waitedMinutes,
    at: new Date(event.at).toISOString(),
  }));

  return (
    // Same width as the line detail page: enough for a sidebar and a form side by
    // side without the form stretching into an unreadably long line.
    <div className="page page-narrow">
      <PageHeader
        title="Settings"
        description="Changes take effect within 30 seconds."
      />

      <main id="main">
        <SettingsTabs
          autoOffline={autoOffline}
          autoOfflineEvents={offlineEventViews}
          chatwoot={view}
          emails={emails}
          userEmail={user.email ?? ""}
        />
      </main>
    </div>
  );
}
