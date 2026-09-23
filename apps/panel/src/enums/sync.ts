/** What the Funnel keeps a copy of; also the `source` column of bridge.sync_state. */
export enum SyncSource {
  Conversations = 'conversations',
}

/** What a refresh should do for one source — see planRun in lib/sync-math.ts. */
export enum RunPlan {
  Skip = 'skip',
  Walk = 'walk',
  Run = 'run',
}

/** How one source's refresh ended. */
export enum SourceStatus {
  Ok = 'ok',
  Partial = 'partial',
  Skipped = 'skipped',
  Busy = 'busy',
  Failed = 'failed',
  Unavailable = 'unavailable',
}
