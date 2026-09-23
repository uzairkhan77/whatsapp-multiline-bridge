'use client'

// framework
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// components
import { Icon } from './icons'

export interface ToastItem {
  id: number
  message: string
}

// Long enough to read a two-sentence warning; each can also be dismissed early.
const TOAST_MS = 12_000

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  // The latest callback, so a parent re-rendering does not restart the timer.
  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  })
  useEffect(() => {
    const timer = setTimeout(() => dismiss.current(item.id), TOAST_MS)
    return () => clearTimeout(timer)
  }, [item.id])

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-surface animate-[rise_0.3s_ease-out] rounded-xl shadow-(--shadow-raised)"
    >
      <div className="callout callout-warn">
        <Icon.Warning className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="flex-1 text-sm">{item.message}</span>
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          aria-label="Dismiss"
          className="-mt-0.5 -mr-1 shrink-0 rounded px-1.5 text-lg leading-none opacity-70 hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  )
}

/**
 * Toast stack, portalled to <body>: callers sit inside the page header, whose
 * styling would otherwise make `fixed` position against the header, not the screen.
 */
export function Toasts({
  items,
  onDismiss,
}: {
  items: readonly ToastItem[]
  onDismiss: (id: number) => void
}) {
  if (items.length === 0) return null
  return createPortal(
    <div className="fixed right-4 bottom-4 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  )
}
