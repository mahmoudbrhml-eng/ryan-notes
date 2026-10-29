'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Icon from './Icon'

// Wraps the 3-panel workspace and adds:
// 1. Touch swipe (phone) to move between panels, RTL-aware.
// 2. Keyboard arrow keys (desktop), skipped while typing.
// 3. Floating edge arrows on small screens.
const ORDER = ['sources', 'notes', 'studio'] as const
type P = (typeof ORDER)[number]

export default function PanelSwipe({
  current,
  hrefFor,
  labels,
  children,
}: {
  current: string
  hrefFor: (p: P) => string
  labels: { next: string; prev: string }
  children: ReactNode
}) {
  const router = useRouter()
  const start = useRef<{ x: number; y: number } | null>(null)
  const lock = useRef(false)

  const go = (dir: 1 | -1) => {
    const i = ORDER.indexOf(current as P)
    const j = Math.min(ORDER.length - 1, Math.max(0, i + dir))
    if (j === i || lock.current) return
    lock.current = true
    router.push(hrefFor(ORDER[j]), { scroll: false })
    setTimeout(() => (lock.current = false), 450)
  }

  // Desktop: arrow keys switch panels (RTL-aware), unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.closest('input, textarea, select, [contenteditable="true"]') || el.closest('.pagedjs'))) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const rtl = document.documentElement.dir === 'rtl'
      const forward = rtl ? e.key === 'ArrowLeft' : e.key === 'ArrowRight'
      go(forward ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const inHorizontalScroller = (t: EventTarget | null) =>
    !!(t instanceof Element && t.closest('.overflow-x-auto, [data-no-swipe]'))

  return (
    <div
      onTouchStart={(e) => {
        if (inHorizontalScroller(e.target)) return
        const t = e.touches[0]
        start.current = { x: t.clientX, y: t.clientY }
      }}
      onTouchEnd={(e) => {
        if (!start.current || inHorizontalScroller(e.target)) return (start.current = null)
        const t = e.changedTouches[0]
        const dx = t.clientX - start.current.x
        const dy = t.clientY - start.current.y
        start.current = null
        if (Math.abs(dx) < 64 || Math.abs(dy) > 56) return
        const rtl = document.documentElement.dir === 'rtl'
        const forward = rtl ? dx > 0 : dx < 0
        go(forward ? 1 : -1)
      }}
    >
      {children}

      {/* Floating edge arrows (phones/tablets) */}
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label={labels.prev}
        className="btn btn-icon fixed top-1/2 z-20 hidden h-9 w-9 !rounded-full bg-surface/80 opacity-70 shadow backdrop-blur hover:!opacity-100 max-[1099px]:grid -translate-y-1/2 start-3"
      >
        <Icon name="back" className="h-4 w-4 rtl:rotate-180" />
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label={labels.next}
        className="btn btn-icon fixed top-1/2 z-20 hidden h-9 w-9 !rounded-full bg-surface/80 opacity-70 shadow backdrop-blur hover:!opacity-100 max-[1099px]:grid -translate-y-1/2 end-3"
      >
        <Icon name="back" className="h-4 w-4 rotate-180 rtl:rotate-0" />
      </button>
    </div>
  )
}
