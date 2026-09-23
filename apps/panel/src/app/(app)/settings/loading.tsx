// components
import { PageHeaderSkeleton } from '@/components/ui/skeletons'

/**
 * The settings shape: the section list on the left, the chosen section's form
 * on the right.
 */
export default function Loading() {
  return (
    <div className="page page-narrow" aria-busy="true">
      <PageHeaderSkeleton title="w-32" description="w-[32rem]" />

      <div className="grid grid-cols-1 items-start gap-gutter md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="skeleton h-[15rem] rounded-[var(--radius-card)]" />

        <div className="skeleton h-[26rem] rounded-[var(--radius-card)]" />
      </div>

      <span className="sr-only" role="status">
        Loading settings
      </span>
    </div>
  )
}
