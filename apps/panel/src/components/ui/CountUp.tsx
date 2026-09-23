'use client'

// framework
import { useEffect, useRef, useState } from 'react'

/**
 * Animates a formatted number up from zero on first paint (e.g. "2.3K", "$11,000").
 * Skips the animation for prefers-reduced-motion and on the server.
 */
const PATTERN = /^([^\d-]*)(-?\d[\d,]*)(\.\d+)?(.*)$/

export function CountUp({ value, duration = 900 }: { value: string; duration?: number }) {
  const [text, setText] = useState(value)
  const last = useRef<string | null>(null)

  useEffect(() => {
    const match = PATTERN.exec(value)
    if (!match) {
      setText(value)
      return
    }
    let reduced = false
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      /* assume motion is fine */
    }
    // Animate only on first appearance or an actual value change, not a same-value refresh.
    if (reduced || last.current === value) {
      setText(value)
      return
    }
    last.current = value

    const [, prefix, whole, fraction = '', suffix] = match
    const grouped = whole!.includes(',')
    const decimals = fraction ? fraction.length - 1 : 0
    const target = Number(`${whole!.replace(/,/g, '')}${fraction}`)
    if (!Number.isFinite(target)) {
      setText(value)
      return
    }
    const format = (n: number) => {
      const fixed = n.toFixed(decimals)
      const [int, dec] = fixed.split('.')
      const intText = grouped ? Number(int).toLocaleString('en') : int!
      return `${prefix}${intText}${dec !== undefined ? `.${dec}` : ''}${suffix}`
    }

    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setText(t < 1 ? format(target * eased) : value)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return <>{text}</>
}
