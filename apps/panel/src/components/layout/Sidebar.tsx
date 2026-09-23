'use client'

// framework
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// components
import { Icon } from '../ui/icons'

type NavItem = {
  href: string
  label: string
  hint: string
  icon: (props: { className?: string }) => React.ReactElement
  active: (pathname: string) => boolean
}

// The screens the console is built around. Lines detail pages count as "Lines"
// for highlighting — a drill-down, not a fourth destination.
const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Lines',
    hint: 'Numbers and traffic',
    icon: Icon.Connected,
    active: (pathname) => pathname === '/' || pathname.startsWith('/lines'),
  },
  {
    href: '/funnel',
    label: 'Funnel',
    hint: 'Team performance',
    icon: Icon.Activity,
    active: (pathname) => pathname.startsWith('/funnel'),
  },
]

function NavLink({
  href,
  label,
  hint,
  icon: Glyph,
  active,
  collapsed,
}: {
  href: string
  label: string
  hint?: string
  icon: NavItem['icon']
  active: boolean
  collapsed: boolean
}) {
  return (
    <Link
      href={href}
      // Prefetching the other screens while this one is read makes switching feel instant.
      // `prefetch` (true) forces the full page, not just its loading state.
      prefetch
      aria-current={active ? 'page' : undefined}
      title={collapsed ? label : undefined}
      className={`group/link relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold transition-all duration-200 ${
        collapsed ? 'justify-center' : ''
      } ${
        active
          ? 'text-accent bg-white/75 shadow-[0_6px_18px_-8px_rgb(4_60_130/0.35),inset_0_1px_0_rgb(255_255_255/0.9)] ring-1 ring-white/90 backdrop-blur-md'
          : 'text-muted hover:bg-white/40 hover:text-fg'
      }`}
    >
      {/* The active marker: a short bar on the left edge. */}
      <span
        aria-hidden="true"
        className={`bg-accent absolute top-1/2 -left-2.5 h-6 w-1 -translate-y-1/2 rounded-full transition-all duration-300 ${
          active ? 'opacity-100' : 'scale-y-0 opacity-0'
        }`}
      />
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ${
          active
            ? 'bg-accent text-white shadow-[var(--shadow-accent)]'
            : 'bg-surface-2 text-muted ring-1 ring-fg/5 ring-inset group-hover/link:bg-fg/8'
        }`}
      >
        <Glyph className="h-4 w-4" />
      </span>
      {!collapsed && (
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate">{label}</span>
          {hint && (
            <span className={`block truncate text-[11px] font-normal ${active ? 'text-accent/70' : 'text-muted-2'}`}>
              {hint}
            </span>
          )}
        </span>
      )}
      {!collapsed && active && <Icon.ChevronRight className="text-accent/60 h-3.5 w-3.5 shrink-0" />}
    </Link>
  )
}

/**
 * Persistent navigation chrome. Rendered by AppShell twice — desktop sidebar and
 * phone drawer — from the same component so the two can't drift.
 */
export function Sidebar({
  collapsed,
  onToggleCollapse,
  onClose,
  footer,
}: {
  collapsed: boolean
  /** Present on the desktop sidebar only. */
  onToggleCollapse?: () => void
  /** Present inside the phone drawer only. */
  onClose?: () => void
  footer: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="card text-fg relative flex h-full flex-col gap-1 overflow-hidden p-3">

      <div className={`relative mb-5 flex items-center gap-3 px-1 pt-1 ${collapsed ? 'justify-center' : ''}`}>
        <span className="bg-accent float flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white shadow-[var(--shadow-accent)]">
          S
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[15px] font-bold tracking-tight">Operator Console</span>
            <span className="block truncate text-[11px] text-muted-2">WhatsApp operations</span>
          </span>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-fg/5 hover:text-fg"
          >
            <Icon.Close className="h-4.5 w-4.5" />
          </button>
        )}
      </div>

      {!collapsed && <p className="eyebrow mb-2 px-2.5 text-muted-2">Screens</p>}
      <ul className="relative flex flex-col gap-1.5">
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <NavLink {...item} active={item.active(pathname)} collapsed={collapsed} />
          </li>
        ))}
      </ul>

      <div className="relative mt-auto flex flex-col gap-1.5 border-t border-line pt-3">
        <NavLink
          href="/settings"
          label="Settings"
          hint="Chatwoot, alerts, account"
          icon={Icon.Gear}
          active={pathname.startsWith('/settings')}
          collapsed={collapsed}
        />
        {footer}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            className={`mt-1 flex items-center gap-3 rounded-xl px-2.5 py-2 text-xs text-muted transition-colors duration-150 hover:bg-fg/5 hover:text-fg ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-fg/5 ring-inset">
              <Icon.PanelLeft className={`h-4 w-4 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
            </span>
            {!collapsed && <span>Collapse sidebar</span>}
          </button>
        )}
      </div>
    </nav>
  )
}
