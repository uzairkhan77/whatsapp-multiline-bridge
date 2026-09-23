'use client'

// framework
import { useState } from 'react'

// enums
import { SettingsSection } from '@/enums/settings-section'

// types
import type {
  AutoOfflineEventView,
  AutoOfflineView,
  SettingsView,
} from '@/types/settings-view'

// components
import { AutoOfflineForm } from '@/components/settings/AutoOfflineForm'
import { ChangePassword } from '@/components/settings/ChangePassword'
import { NotificationEmails } from '@/components/settings/NotificationEmails'
import { SettingsForm } from '@/components/settings/SettingsForm'
import { Icon } from '@/components/ui/icons'

const SECTIONS: { id: SettingsSection; label: string; hint: string; icon: keyof typeof Icon }[] = [
  { id: SettingsSection.Account, label: 'Account', hint: 'Your sign-in and password', icon: 'Shield' },
  { id: SettingsSection.Chatwoot, label: 'Chatwoot', hint: 'The account lines deliver into', icon: 'Chat' },
  { id: SettingsSection.Availability, label: 'Availability', hint: 'When agents are set Offline', icon: 'Clock' },
  { id: SettingsSection.Notifications, label: 'Notifications', hint: 'Who gets alert emails', icon: 'Mail' },
]

/**
 * Sidebar of categories on the left, the chosen section on the right. Sections
 * stay mounted and only the active one is shown, so a half-filled form survives.
 */
export function SettingsTabs({
  autoOffline,
  autoOfflineEvents,
  chatwoot,
  emails,
  userEmail,
}: {
  autoOffline: AutoOfflineView | null
  autoOfflineEvents: AutoOfflineEventView[]
  chatwoot: SettingsView
  emails: string[]
  userEmail: string
}) {
  const [section, setSection] = useState<SettingsSection>(SettingsSection.Account)

  return (
    <div className="grid grid-cols-1 items-start gap-gutter md:grid-cols-[240px_minmax(0,1fr)]">
      {/* min-w-0: a grid item's default minimum is its content width, and the
          content here is a row of buttons that must scroll on a phone, not
          widen the page. */}
      <nav
        aria-label="Settings sections"
        className="reveal min-w-0 md:sticky md:top-5"
        style={{ ['--i' as string]: 1 }}
      >
        <ul className="card flex gap-1 overflow-x-auto p-1.5 md:flex-col md:overflow-visible md:p-2">
          {SECTIONS.map(({ id, label, hint, icon }) => {
            const active = section === id
            const Glyph = Icon[icon]
            return (
              <li key={id} className="shrink-0 md:shrink">
                <button
                  onClick={() => setSection(id)}
                  aria-current={active ? 'true' : undefined}
                  // The same active treatment as the sidebar, class for class —
                  // one idea of "this is the screen you are on", used twice.
                  className={`group/tab relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold transition-all duration-200 md:items-start md:gap-3 md:py-2.5 ${
                    active
                      ? 'text-accent bg-white/75 shadow-[0_6px_18px_-8px_rgb(4_60_130/0.35),inset_0_1px_0_rgb(255_255_255/0.9)] ring-1 ring-white/90 backdrop-blur-md'
                      : 'text-muted hover:bg-white/40 hover:text-fg'
                  }`}
                >
                  {/* The active marker: a short bar on the left edge, as in the sidebar. */}
                  <span
                    aria-hidden="true"
                    className={`bg-accent absolute top-1/2 -left-0.5 hidden h-6 w-1 -translate-y-1/2 rounded-full transition-all duration-300 md:block ${
                      active ? 'opacity-100' : 'scale-y-0 opacity-0'
                    }`}
                  />
                  <span
                    className={`icon-tile h-9 w-9 shrink-0 rounded-xl transition-all duration-200 ${
                      active
                        ? 'bg-accent text-white shadow-[var(--shadow-accent)]'
                        : 'bg-surface-2 text-muted ring-1 ring-fg/5 ring-inset group-hover/tab:bg-fg/8'
                    }`}
                  >
                    <Glyph className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate whitespace-nowrap md:whitespace-normal">{label}</span>
                    {/* The hint earns its space only in the sidebar; as a top row on
                        a phone it would double the nav's height for little gain. */}
                    <span
                      className={`hidden text-[11px] font-normal md:block ${active ? 'text-accent/70' : 'text-muted-2'}`}
                    >
                      {hint}
                    </span>
                  </span>
                  {active && <Icon.ChevronRight className="text-accent/60 hidden h-3.5 w-3.5 shrink-0 md:block" />}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="reveal min-w-0" style={{ ['--i' as string]: 2 }}>
        <div hidden={section !== SettingsSection.Account}>
          <ChangePassword email={userEmail} />
        </div>
        <div hidden={section !== SettingsSection.Chatwoot}>
          <SettingsForm initial={chatwoot} />
        </div>
        {/* No `active` gate: everything this section shows is
            already in the props, so there is no Chatwoot call to hold back. */}
        <div hidden={section !== SettingsSection.Availability}>
          <AutoOfflineForm initial={autoOffline} events={autoOfflineEvents} />
        </div>
        {/* One card, not two. Sending is configured by an environment variable
            now (Resend), so the only thing left to edit here is the list. */}
        <div hidden={section !== SettingsSection.Notifications}>
          <NotificationEmails emails={emails} />
        </div>
      </div>
    </div>
  )
}
