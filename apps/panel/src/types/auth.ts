// Auth domain: who is signed in.

/** What the pages need to know about who is signed in — and nothing more. */
export interface User {
  id: string
  email: string | undefined
}
