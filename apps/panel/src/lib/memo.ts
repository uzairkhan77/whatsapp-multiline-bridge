import 'server-only'

// types
import type { Remembered } from '@/types/memo'

// A small in-process memo for reads that make a page slow or flaky. A value is
// fresh for `ttlMs`; past that a failed read serves the last good value for up
// to `staleMs`, flagged stale. `swrMs` adds a third mode for slow remote calls:
// serve at once and refresh in the background. `forget()` invalidates on write.
// Per process on purpose — a handful of internal users, not shared across machines.

interface Entry<T> {
  value: T
  at: number
  inflight: Promise<T> | null
}

const store = new Map<string, Entry<unknown>>()

export async function remember<T>(
  key: string,
  read: () => Promise<T>,
  { ttlMs = 0, staleMs = 10 * 60_000, swrMs = 0 }: { ttlMs?: number; staleMs?: number; swrMs?: number } = {},
): Promise<Remembered<T>> {
  const now = Date.now()
  const entry = store.get(key) as Entry<T> | undefined

  if (entry && now - entry.at < ttlMs) return { value: entry.value, stale: false, at: entry.at }

  if (entry && entry.at > 0 && now - entry.at < swrMs) {
    if (!entry.inflight) {
      const refresh = read()
      entry.inflight = refresh
      refresh
        .then((value) => store.set(key, { value, at: Date.now(), inflight: null }))
        .catch(() => {
          const current = store.get(key) as Entry<T> | undefined
          if (current) current.inflight = null
        })
    }
    return { value: entry.value, stale: false, at: entry.at }
  }

  // Share one request between concurrent readers, e.g. the dashboard's
  // per-inbox reads overlapping the auto-refresh timer.
  let inflight = entry?.inflight ?? null
  if (!inflight) {
    inflight = read()
    if (entry) entry.inflight = inflight
    else store.set(key, { value: undefined as T, at: 0, inflight })
  }

  try {
    const value = await inflight
    const at = Date.now()
    store.set(key, { value, at, inflight: null })
    return { value, stale: false, at }
  } catch (error) {
    const current = store.get(key) as Entry<T> | undefined
    if (current) current.inflight = null
    if (current && current.at > 0 && now - current.at < staleMs) {
      return { value: current.value, stale: true, at: current.at }
    }
    if (current && current.at === 0) store.delete(key)
    throw error
  }
}

/** Time a read and log a warning when it is slow, to say which source is the cause. */
export async function timed<T>(name: string, read: () => Promise<T>, slowMs = 2_500): Promise<T> {
  const started = Date.now()
  try {
    return await read()
  } finally {
    const ms = Date.now() - started
    if (ms >= slowMs) console.warn(`[panel] slow read: ${name} took ${ms}ms`)
  }
}

/** Drop every memo whose key starts with the prefix — called by the write that changed it. */
export function forget(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
