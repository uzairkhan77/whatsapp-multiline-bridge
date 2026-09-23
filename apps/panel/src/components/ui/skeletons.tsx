/**
 * Shared loading skeletons, kept in one place so every screen's placeholder
 * matches its real shape and size.
 */

/** The title block: a heading and its one-line description, at PageHeader's size. */
export function PageHeaderSkeleton({
  title = 'w-40',
  description = 'w-80',
  actions = false,
}: {
  /** Width class, roughly the real title's length. */
  title?: string
  description?: string | false
  actions?: boolean
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="mr-auto min-w-0">
        <div className={`skeleton h-8 max-w-full rounded-md ${title}`} />
        {description && <div className={`skeleton mt-2 h-4 max-w-full rounded ${description}`} />}
      </div>
      {actions && (
        <div className="flex items-center gap-2">
          <div className="skeleton h-10 w-40 rounded-[var(--radius-control)]" />
          <div className="skeleton h-10 w-28 rounded-[var(--radius-control)]" />
        </div>
      )}
    </div>
  )
}

/** The filter bar, at the height of the real one. */
export function FilterBarSkeleton() {
  return <div className="skeleton h-[3.4rem] w-full rounded-[var(--radius-card)]" />
}

/** The table, as one block the size the table will be. */
export function TableSkeleton({ rows = 8 }: { rows?: number; columns?: number }) {
  // Heading row of small caps, then rows tall enough for an avatar and two lines of text.
  const height = `${2.6 + rows * 3.5}rem`
  return <div className="skeleton w-full rounded-[var(--radius-card)]" style={{ height }} />
}
