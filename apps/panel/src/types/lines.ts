// Types for the routing table of configured lines (lib/lines.ts).

export interface ConfiguredLine {
  instance: string
  /** Null when the inbox was detached: the line keeps its settings but routes nothing. */
  chatwootInboxId: number | null
  fallbackInstance: string | null
  enabled: boolean
}

/** One conversation's arrival: whose number it was, which line it came in on, and when. */
export interface LineArrival {
  phone: string | null
  instance: string
  assignedAt: Date
}
