'use client'

import { useEffect, useState } from 'react'
import type { Dict } from '@/lib/dict'

type Usage = { total: number; limit: number; features: Record<string, number> }

// Small muted chip showing today's AI consumption against the daily limit,
// with a per-feature breakdown on hover. Renders nothing until data arrives,
// and stays silent on any failure — it must never look broken.
export default function UsageBadge({ t }: { t: Dict['usage'] }) {
  const [u, setU] = useState<Usage | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/ai/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j && typeof j.total === 'number') setU(j)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  if (!u || u.total === 0) return null

  const names: Record<string, string> = {
    transcribe: t.transcribe,
    summary: t.summary,
    quiz: t.quiz,
    chat: t.chat,
    merge: t.merge,
    other: t.other,
  }
  const detail = Object.entries(u.features)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${names[k] ?? k}: ${n}`)
    .join(' · ')

  return (
    <span
      className="chip select-none"
      title={`${t.chip}: ${detail || t.other}`}
      dir="ltr"
    >
      AI {u.total}/{u.limit}
    </span>
  )
}
