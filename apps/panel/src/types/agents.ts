// Agents domain: the cached Chatwoot agent roster.

import type { ChatwootAgent } from './chatwoot'

export interface Roster {
  agents: ChatwootAgent[]
  /** Lower-cased email to display name. */
  byEmail: Map<string, string>
  byId: Map<number, string>
  /**
   * No names from anywhere: Chatwoot could not be reached and the cache has never
   * been filled. Only state worth telling the user about.
   */
  empty: boolean
}
