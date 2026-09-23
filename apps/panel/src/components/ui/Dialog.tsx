'use client'

// framework
import { useEffect, useRef } from 'react'

// components
import { Icon } from './icons'

/**
 * Modal built on the native <dialog> element for built-in focus trapping,
 * Escape-to-close, and top-layer stacking.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(event) => {
        // Backdrop click closes: clicking the backdrop targets the dialog itself, not a child.
        if (event.target === ref.current) onClose()
      }}
      aria-labelledby="dialog-title"
      className="glass-raised text-fg m-auto w-[min(30rem,calc(100vw-2rem))] rounded-[var(--radius-card)] p-0 backdrop:bg-[#0b1f3f]/45 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-5 pb-4">
        <div>
          <h2 id="dialog-title" className="text-lg font-bold tracking-tight text-balance">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted hover:text-fg hover:bg-surface-2 -m-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors duration-150 hover:border-line"
        >
          <Icon.Close className="h-5 w-5" />
        </button>
      </div>

      <div className="p-5">{children}</div>

      {footer && (
        <div className="flex flex-wrap justify-end gap-2 rounded-b-[var(--radius-card)] border-t border-line bg-surface-2/60 px-5 py-4">
          {footer}
        </div>
      )}
    </dialog>
  )
}
