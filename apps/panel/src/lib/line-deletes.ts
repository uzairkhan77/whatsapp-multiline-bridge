// framework
import { useSyncExternalStore } from 'react'

// types
import type { DeleteFailure, LineDeletes } from '@/types/line-deletes'

// lib
import { deleteLine } from '@/app/actions'

// Deleting a line is optimistic: it disappears the moment the delete is
// confirmed, while the real delete runs behind it. On failure it comes back
// and a toast says why. Held here rather than in the triggering component,
// since that component is usually gone (its page navigates away) by the time
// the answer arrives.

const EMPTY: LineDeletes = { hidden: new Set(), failures: [], settled: 0 }
let state = EMPTY
let nextId = 1
const listeners = new Set<() => void>()

function update(next: Partial<LineDeletes>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function without(set: ReadonlySet<string>, instance: string): Set<string> {
  const copy = new Set(set)
  copy.delete(instance)
  return copy
}

export function deleteInBackground(instance: string): void {
  if (state.hidden.has(instance)) return
  update({ hidden: new Set(state.hidden).add(instance) })

  void deleteLine(instance)
    .then((result) => (result.ok ? null : (result.error ?? 'The delete failed.')))
    .catch(() => 'The panel server could not be reached.')
    .then((error) => {
      update({
        // A successful delete stays hidden until the page re-fetches: the
        // server's last answer still lists the line otherwise.
        hidden: error ? without(state.hidden, instance) : state.hidden,
        failures: error ? [...state.failures, { id: nextId++, instance, error }] : state.failures,
        settled: state.settled + 1,
      })
    })
}

/** A new line may reuse a deleted one's name; it must not inherit its hiding. */
export function unhideLine(instance: string): void {
  if (state.hidden.has(instance)) update({ hidden: without(state.hidden, instance) })
}

export function dismissDeleteFailure(id: number): void {
  update({ failures: state.failures.filter((failure) => failure.id !== id) })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLineDeletes(): LineDeletes {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY)
}
