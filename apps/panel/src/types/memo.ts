// Memo domain: the wrapper returned by the small in-process memo cache.

export interface Remembered<T> {
  value: T
  /** True when the read failed and this is the last good value instead. */
  stale: boolean
  /** When the value was actually read, for a "as of" note. */
  at: number
}
