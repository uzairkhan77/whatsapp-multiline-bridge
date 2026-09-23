// components
import { FilterBarSkeleton, PageHeaderSkeleton, TableSkeleton } from '@/components/ui/skeletons'

/** The Funnel screen's own shapes, at the real dimensions, in the real order. */
export default function Loading() {
  return (
    <div className="page" aria-busy="true">
      <PageHeaderSkeleton title="w-28" description="w-[26rem]" />

      <div className="mb-gutter">
        <FilterBarSkeleton />
      </div>

      <div className="mb-gutter grid grid-cols-2 gap-gutter lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="skeleton h-[7.5rem] rounded-[var(--radius-card)]" />
        ))}
      </div>

      <div className="skeleton mb-gutter h-[236px] rounded-[var(--radius-card)]" />

      <div className="skeleton mb-3 h-4 w-24 rounded" />
      <TableSkeleton rows={5} />

      <span className="sr-only" role="status">
        Loading funnel
      </span>
    </div>
  )
}
