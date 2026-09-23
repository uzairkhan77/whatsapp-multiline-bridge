// components
import { PageHeaderSkeleton } from '@/components/ui/skeletons'

/**
 * Its own skeleton, not the dashboard's — otherwise the detail route flashes a
 * different layout before settling.
 */
export default function Loading() {
  return (
    <div className="page page-narrow" aria-busy="true">
      <PageHeaderSkeleton title="w-56" description="w-72" actions />
      <div className="grid grid-cols-1 gap-gutter lg:grid-cols-3">
        <div className="skeleton h-[300px] rounded-[var(--radius-card)] lg:col-span-2" />
        <div className="skeleton h-[300px] rounded-[var(--radius-card)]" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="skeleton h-[280px] rounded-[var(--radius-card)]" />
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading line
      </span>
    </div>
  )
}
