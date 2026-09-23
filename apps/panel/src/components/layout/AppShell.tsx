'use client'

// framework
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

// components
import { LineDeleteHost } from '../lines/LineDeleteHost'
import { Icon } from '../ui/icons'
import { Sidebar } from './Sidebar'

const COLLAPSED_KEY = 'panel.sidebar.collapsed'

/**
 * Application chrome: a floating sidebar (collapsible to an icon rail) on desktop,
 * a top bar with a slide-in drawer on phones. Pages render into the remaining space.
 */
export function AppShell({
  signedInAs,
  children,
}: {
  signedInAs: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Read after mount, not during render: the server has no localStorage, and a
  // mismatch there would re-render the whole shell on hydration.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === '1')
    } catch {
      /* private mode, blocked storage — the default is fine */
    }
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // A navigation closes the drawer; a drawer that stays open over the page it
  // just opened reads as a stuck menu.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Escape closes the drawer, and the page behind it stops scrolling while it is up.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [drawerOpen])

  return (
    <div className="flex min-h-dvh">
      {/*
        Desktop sidebar floats inside the gutter. `pr-0` avoids doubling the gutter —
        the page's own padding supplies the space on that side.
      */}
      <aside
        data-collapsed={collapsed ? '' : undefined}
        className={`group sticky top-0 hidden h-dvh shrink-0 p-gutter pr-0 transition-[width] duration-300 ease-[var(--ease-out-soft)] lg:block ${
          collapsed ? 'w-[5.5rem]' : 'w-[17.5rem]'
        }`}
      >
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} footer={signedInAs} />
      </aside>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-40 lg:hidden ${drawerOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!drawerOpen}
      >
        <div
          onClick={() => setDrawerOpen(false)}
          className={`absolute inset-0 bg-surface/85 backdrop-blur-sm transition-opacity duration-300 ${
            drawerOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          className={`absolute inset-y-0 left-0 w-[18rem] max-w-[85vw] p-gutter transition-transform duration-300 ease-[var(--ease-out-soft)] ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <Sidebar collapsed={false} onClose={() => setDrawerOpen(false)} footer={signedInAs} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        {/* `mb-0`: the page below brings its own top gutter, so a margin here too
            would double the space between the bar and the first card. */}
        <header className="sticky top-0 z-30 m-gutter mb-0 flex items-center gap-3 rounded-2xl border border-line bg-surface/85 px-3 py-2.5 backdrop-blur-xl lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="text-fg inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-fg/5 transition-colors duration-150 hover:bg-fg/5"
          >
            <Icon.Menu className="h-5 w-5" />
          </button>
          <span className="bg-accent-gradient flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white shadow-[var(--shadow-accent)]">
            S
          </span>
          <span className="text-sm font-semibold tracking-tight">Operator Console</span>
        </header>

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <LineDeleteHost />
    </div>
  )
}
