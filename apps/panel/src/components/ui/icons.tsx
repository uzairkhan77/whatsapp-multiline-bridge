// Inline line icons — no icon package, no emoji (inconsistent rendering, no accessible name).
// All icons are decorative (aria-hidden); the surrounding control provides the accessible name.

type Props = { className?: string }

function Svg({ children, className }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const Icon = {
  Connected: (p: Props) => (
    <Svg {...p}>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <path d="M12 20h.01" />
    </Svg>
  ),
  Disconnected: (p: Props) => (
    <Svg {...p}>
      <path d="M12 20h.01" />
      <path d="M8.5 16.4a5 5 0 0 1 7 0" />
      <path d="m2 2 20 20" />
      <path d="M5 12.6a10 10 0 0 1 5.2-2.4" />
      <path d="M16.8 10.7a10 10 0 0 1 2.2 1.9" />
    </Svg>
  ),
  Connecting: (p: Props) => (
    <Svg {...p}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Svg>
  ),
  Paused: (p: Props) => (
    <Svg {...p}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </Svg>
  ),
  Warning: (p: Props) => (
    <Svg {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  ),
  Qr: (p: Props) => (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3z" />
      <path d="M21 14v3" />
      <path d="M17 21h4" />
    </Svg>
  ),
  Logout: (p: Props) => (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  ),
  Trash: (p: Props) => (
    <Svg {...p}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  ),
  Plus: (p: Props) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Refresh: (p: Props) => (
    <Svg {...p}>
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </Svg>
  ),
  In: (p: Props) => (
    <Svg {...p}>
      <path d="M17 7 7 17" />
      <path d="M17 17H7V7" />
    </Svg>
  ),
  Out: (p: Props) => (
    <Svg {...p}>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </Svg>
  ),
  Chat: (p: Props) => (
    <Svg {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </Svg>
  ),
  Clock: (p: Props) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  Close: (p: Props) => (
    <Svg {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  ),
  Link: (p: Props) => (
    <Svg {...p}>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </Svg>
  ),
  Gear: (p: Props) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.98 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.98a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.22.63.8 1.05 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.97Z" />
    </Svg>
  ),
  Eye: (p: Props) => (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  // Struck-through eye for "visible — click to hide"; slash runs corner-to-corner
  // so the two states differ at a glance.
  EyeOff: (p: Props) => (
    <Svg {...p}>
      <path d="M10.7 6.2A9.6 9.6 0 0 1 12 6.1c6 0 9.5 6 9.5 6a17 17 0 0 1-2.5 3.2" />
      <path d="M6.3 7.8A17 17 0 0 0 2.5 12s3.5 6 9.5 6a9.3 9.3 0 0 0 4-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </Svg>
  ),
  Search: (p: Props) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  ),
  SortUp: (p: Props) => (
    <Svg {...p}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  ),
  SortDown: (p: Props) => (
    <Svg {...p}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Svg>
  ),
  ChevronLeft: (p: Props) => (
    <Svg {...p}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  ),
  ChevronRight: (p: Props) => (
    <Svg {...p}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  ),
  ChevronDown: (p: Props) => (
    <Svg {...p}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  Info: (p: Props) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </Svg>
  ),
  Menu: (p: Props) => (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  ),
  PanelLeft: (p: Props) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="m15 10-2 2 2 2" />
    </Svg>
  ),
  Activity: (p: Props) => (
    <Svg {...p}>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </Svg>
  ),
  Users: (p: Props) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M17.5 13.6A6.5 6.5 0 0 1 21.5 20" />
    </Svg>
  ),
  Dollar: (p: Props) => (
    <Svg {...p}>
      <path d="M12 3v18" />
      <path d="M16.5 7.5A3.5 3.5 0 0 0 13 5h-2.5a3 3 0 0 0 0 6h3a3 3 0 0 1 0 6H11a3.5 3.5 0 0 1-3.5-2.5" />
    </Svg>
  ),
  Target: (p: Props) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </Svg>
  ),
  Bag: (p: Props) => (
    <Svg {...p}>
      <path d="M6 8h12l1 13H5L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Svg>
  ),
  ArrowLeft: (p: Props) => (
    <Svg {...p}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </Svg>
  ),
  External: (p: Props) => (
    <Svg {...p}>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </Svg>
  ),
  Copy: (p: Props) => (
    <Svg {...p}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </Svg>
  ),
  Check: (p: Props) => (
    <Svg {...p}>
      <path d="m5 12 5 5L20 7" />
    </Svg>
  ),
  Mail: (p: Props) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Svg>
  ),
  Shield: (p: Props) => (
    <Svg {...p}>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  ),
}
