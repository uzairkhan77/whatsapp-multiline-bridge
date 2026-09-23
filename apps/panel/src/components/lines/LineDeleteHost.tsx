'use client'

// framework
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// lib
import { dismissDeleteFailure, useLineDeletes } from '@/lib/line-deletes'

// components
import { Toasts } from '../ui/Toast'

/**
 * The other half of an optimistic delete, mounted once in the app shell so it is
 * there whichever page the person is on when a delete finishes.
 */
export function LineDeleteHost() {
  const router = useRouter()
  const { failures, settled } = useLineDeletes()

  // A finished delete, success or not, changes what the server would show —
  // fetch the page again so counts and cards match it.
  useEffect(() => {
    if (settled > 0) router.refresh()
  }, [settled, router])

  return (
    <Toasts
      items={failures.map((failure) => ({
        id: failure.id,
        message: `Could not delete ${failure.instance}: ${failure.error} It is back on the list.`,
      }))}
      onDismiss={dismissDeleteFailure}
    />
  )
}
