// Types for the optimistic line-delete store (lib/line-deletes.ts).

export interface DeleteFailure {
  id: number
  instance: string
  error: string
}

export interface LineDeletes {
  /** Lines deleted in this tab. Hidden everywhere, from the click onwards. */
  hidden: ReadonlySet<string>
  /** Deletes that failed, for the toasts. Their lines are no longer hidden. */
  failures: readonly DeleteFailure[]
  /** Counts finished deletes, so the page knows when to fetch fresh data. */
  settled: number
}
