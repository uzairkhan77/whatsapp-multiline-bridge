// Sync domain: the Funnel's own copy of Chatwoot's conversations.

import type { SourceStatus, SyncSource } from '@/enums/sync'

export interface SourceOutcome {
  status: SourceStatus
  /** Said on the page when it is worth saying. */
  detail?: string
  rows?: number
  /** A walk through Chatwoot's pages that has not finished: where it is. */
  walk?: { page: number; pages: number; fromStart: boolean }
  /** When a run that completed was recorded, from the database's clock. */
  lastOkAt?: Date
}

export interface SyncReport {
  conversations: SourceOutcome
  /** The last complete run; null until there has been one. */
  asOf: Date | null
  /** The source's row as it stands after this run. */
  state: Map<SyncSource, SyncStateRow> | null
}

export interface SyncOptions {
  /** A person asked: ignore the floor and the backoff. The lease still applies. */
  force?: boolean
  /** Chatwoot pages one run may read. Three keeps a page load under its budget; a button can afford more. */
  pageBudget?: number
  /** Wall clock the conversations run may use before leaving the rest to the next refresh. */
  budgetMs?: number
}

/** One row of bridge.sync_state. */
export interface SyncStateRow {
  source: SyncSource
  watermarkAt: Date | null
  walkPage: number | null
  walkStartedAt: Date | null
  /** YYYY-MM-DD; null means the walk reads from the beginning. */
  walkSince: string | null
  sourceTotal: number | null
  leaseToken: string | null
  leaseUntil: Date | null
  lastRunAt: Date | null
  lastOkAt: Date | null
  lastRows: number | null
  lastError: string | null
}

/** One conversation as the copy keeps it. */
export interface MirrorConversation {
  id: number
  inboxId: number | null
  status: string | null
  createdAt: Date
  lastActivityAt: Date | null
  assigneeId: number | null
  assigneeEmail: string | null
}
