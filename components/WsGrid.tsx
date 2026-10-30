'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

// Desktop-only column resizing for the 3-panel workspace: a slim drag handle
// between the panels changes their widths (double-tap resets), persisted in
// localStorage. Phones keep the stacked full-width layout untouched.
const KEY = 'rn.ws.cols'
const DEF: [number, number] = [330, 330]
const MIN: [number, number] = [230, 300]
const MAX: [number, number] = [470, 760]

const clamp = (i: 0 | 1, v: number) => Math.min(MAX[i], Math.max(MIN[i], Math.round(v)))

export default function WsGrid({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState<[number, number] | null>(null)
  const drag = useRef<{ idx: 0 | 1; lastX: number } | null>(null)

  useEffect(() => {
    let v: [number, number] = DEF
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const p = JSON.parse(raw) as unknown
        if (Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
          v = [clamp(0, p[0] as number), clamp(1, p[1] as number)]
        }
      }
    } catch {}
    setCols(v)
  }, [])

  // The inline template must apply only on the 3-column layout, otherwise it
  // would fight the single-column mobile grid.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const mq = window.matchMedia('(min-width: 1100px)')
    const apply = () => {
      el.style.gridTemplateColumns = mq.matches && cols ? `${cols[0]}px 10px minmax(0,1fr) 10px ${cols[1]}px` : ''
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [cols])

  // In RTL the grid flows right-to-left, so a handle dragged left widens the
  // column that sits before it — the factor flips the delta.
  const factor = () => (document.documentElement.dir === 'rtl' ? -1 : 1)

  const onDown = (idx: 0 | 1) => (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { idx, lastX: e.clientX }
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.lastX) * factor()
    d.lastX = e.clientX
    setCols((c) => {
      const base = c ?? DEF
      const next: [number, number] = [base[0], base[1]]
      next[d.idx] = clamp(d.idx, base[d.idx] + dx)
      return next
    })
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    setCols((c) => {
      if (c) {
        try {
          localStorage.setItem(KEY, JSON.stringify(c))
        } catch {}
      }
      return c
    })
  }
  const onDouble = (idx: 0 | 1) => () => {
    setCols((c) => {
      const next: [number, number] = [c?.[0] ?? DEF[0], c?.[1] ?? DEF[1]]
      next[idx] = DEF[idx]
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  const handle = (idx: 0 | 1) => (
    <div
      key={`h${idx}`}
      role="separator"
      aria-orientation="vertical"
      className="wsh"
      onPointerDown={onDown(idx)}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={onDouble(idx)}
    />
  )

  const kids = Array.isArray(children) ? [...children] : [children]
  return (
    <div ref={ref} className="ws">
      {kids[0]}
      {handle(0)}
      {kids[1]}
      {handle(1)}
      {kids[2]}
    </div>
  )
}
