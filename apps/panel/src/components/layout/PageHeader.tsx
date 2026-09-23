/**
 * Title block every screen opens with: title, one-line description, and
 * screen-level actions on the right.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** A small label above the title — a breadcrumb or a section name. */
  eyebrow?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className="reveal mb-6 flex flex-wrap items-end gap-x-6 gap-y-4" style={{ ['--i' as string]: 0 }}>
      <div className="mr-auto min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs text-muted">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h1>
        {description && <p className="mt-1 text-sm font-medium text-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
