'use client'

// lib
import { useLineDeletes } from '@/lib/line-deletes'

/** Hides a line from the moment its delete is confirmed — see lib/line-deletes. */
export function HideWhileDeleting({
  instance,
  children,
}: {
  instance: string
  children: React.ReactNode
}) {
  const { hidden } = useLineDeletes()
  return hidden.has(instance) ? null : <>{children}</>
}
