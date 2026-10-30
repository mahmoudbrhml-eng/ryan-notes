'use client'

import { useEffect, useState } from 'react'

type Prefs = { fs: number; lh: number; gap: number }
const KEY = 'rn-read'
const DEFAULTS: Prefs = { fs: 1, lh: 1, gap: 1 }
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 100) / 100))
// The spacing button walks through three reading presets that move line
// height AND paragraph/heading gaps together: normal → airy → compact.
const SPACING: Prefs[] = [
  { fs: 1, lh: 1, gap: 1 },
  { fs: 1, lh: 1.3, gap: 1.5 },
  { fs: 1, lh: 0.85, gap: 0.55 },
]

const load = (): Prefs => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<Prefs>
    if (typeof p.fs === 'number' && typeof p.lh === 'number') {
      return {
        fs: clamp(p.fs, 0.8, 1.6),
        lh: clamp(p.lh, 0.8, 1.4),
        gap: clamp(p.gap ?? 1, 0.4, 2),
      }
    }
  } catch { /* nothing stored yet */ }
  return DEFAULTS
}

const same = (a: Prefs, b: Prefs) => a.fs === b.fs && a.lh === b.lh && a.gap === b.gap

// Reading controls for the notes viewer: text size (A− / A+) and spacing,
// applied through CSS variables on <html> and remembered on this device.
export default function ReadControls({ labels }: { labels: { size: string; spacing: string; reset: string } }) {
  const [p, setP] = useState<Prefs>(DEFAULTS)
  useEffect(() => { setP(load()) }, [])
  useEffect(() => {
    const s = document.documentElement.style
    s.setProperty('--read-fs', String(p.fs))
    s.setProperty('--read-lh', String(p.lh))
    s.setProperty('--read-gap', String(p.gap))
    try {
      if (same(p, DEFAULTS)) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, JSON.stringify(p))
    } catch { /* private mode */ }
  }, [p])
  const dirty = !same(p, DEFAULTS)
  const btn = 'btn btn-ghost btn-icon !h-8 !w-8 !min-w-0 !text-xs !font-bold'
  const cycleSpacing = () => {
    // keep the current font size, advance to the next line+paragraph preset
    const i = SPACING.findIndex((s) => s.lh === p.lh && s.gap === p.gap)
    const nx = SPACING[(i + 1) % SPACING.length] ?? SPACING[0]
    setP({ ...p, lh: nx.lh, gap: nx.gap })
  }
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={labels.size}>
      <button type="button" className={btn} title={`${labels.size} −`} aria-label={`${labels.size} −`}
        onClick={() => setP((v) => ({ ...v, fs: clamp(v.fs - 0.1, 0.8, 1.6) }))}>A−</button>
      <button type="button" className={btn} title={`${labels.size} +`} aria-label={`${labels.size} +`}
        onClick={() => setP((v) => ({ ...v, fs: clamp(v.fs + 0.1, 0.8, 1.6) }))}>A+</button>
      <button type="button" className={btn} title={labels.spacing} aria-label={labels.spacing} onClick={cycleSpacing}>
        <span aria-hidden className="flex flex-col items-center gap-[3px] leading-none">
          <i className="block h-[1.5px] w-3.5 rounded bg-current" />
          <i className="block h-[1.5px] w-3.5 rounded bg-current" />
          <i className="block h-[1.5px] w-3.5 rounded bg-current" />
        </span>
      </button>
      {dirty && (
        <button type="button" className={btn} title={labels.reset} aria-label={labels.reset}
          onClick={() => setP(DEFAULTS)}>↺</button>
      )}
    </div>
  )
}
