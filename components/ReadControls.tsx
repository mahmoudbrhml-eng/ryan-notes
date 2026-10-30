'use client'

import { useEffect, useState } from 'react'

type Prefs = { fs: number; lh: number }
const KEY = 'rn-read'
const DEFAULTS: Prefs = { fs: 1, lh: 1 }
const LH_STEPS = [1, 1.3, 0.85]
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 100) / 100))

const load = (): Prefs => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<Prefs>
    if (typeof p.fs === 'number' && typeof p.lh === 'number') {
      return { fs: clamp(p.fs, 0.8, 1.6), lh: clamp(p.lh, 0.8, 1.4) }
    }
  } catch { /* nothing stored yet */ }
  return DEFAULTS
}

// Reading controls for the notes viewer: text size (A− / A+) and line spacing,
// applied through CSS variables on <html> and remembered on this device.
export default function ReadControls({ labels }: { labels: { size: string; spacing: string; reset: string } }) {
  const [p, setP] = useState<Prefs>(DEFAULTS)
  useEffect(() => { setP(load()) }, [])
  useEffect(() => {
    const s = document.documentElement.style
    s.setProperty('--read-fs', String(p.fs))
    s.setProperty('--read-lh', String(p.lh))
    try {
      if (p.fs === 1 && p.lh === 1) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, JSON.stringify(p))
    } catch { /* private mode */ }
  }, [p])
  const dirty = p.fs !== 1 || p.lh !== 1
  const btn = 'btn btn-ghost btn-icon !h-8 !w-8 !min-w-0 !text-xs !font-bold'
  const cycleLh = () =>
    setP((v) => {
      const i = LH_STEPS.indexOf(v.lh)
      return { ...v, lh: LH_STEPS[(i + 1) % LH_STEPS.length] ?? 1 }
    })
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={labels.size}>
      <button type="button" className={btn} title={`${labels.size} −`} aria-label={`${labels.size} −`}
        onClick={() => setP((v) => ({ ...v, fs: clamp(v.fs - 0.1, 0.8, 1.6) }))}>A−</button>
      <button type="button" className={btn} title={`${labels.size} +`} aria-label={`${labels.size} +`}
        onClick={() => setP((v) => ({ ...v, fs: clamp(v.fs + 0.1, 0.8, 1.6) }))}>A+</button>
      <button type="button" className={btn} title={labels.spacing} aria-label={labels.spacing} onClick={cycleLh}>
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
