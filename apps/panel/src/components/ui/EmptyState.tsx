interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  /** Animation slot for the page's staggered reveal; omit for none. */
  index?: number
  children: React.ReactNode
}

/** A card saying a section has nothing in it yet, and what would put something there. */
export function EmptyState({ icon, title, index, children }: EmptyStateProps) {
  return (
    <div
      className={`card p-10 text-center${index === undefined ? '' : ' reveal'}`}
      style={index === undefined ? undefined : { ['--i' as string]: index }}
    >
      <span className="icon-tile bg-accent-soft text-accent mx-auto mb-3 h-12 w-12">{icon}</span>
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>
    </div>
  )
}
