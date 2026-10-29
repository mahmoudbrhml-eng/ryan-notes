'use client'

import { useEffect, useState, type ReactNode } from 'react'

// Old summaries stored before the dense-summary pipeline existed (or failed
// runs) are far too brief for a revision booklet. When such a summary is sent
// to the PDF page, this wrapper pauses everything, quietly regenerates the
// summary with the same endpoint the Studio uses (which upgrades the stored
// row in place), then reloads so the page renders the full content.
// If the upgrade cannot finish (quota, network…), the page falls through and
// renders the stored version — the user still gets a PDF, never a dead end.
export default function AutoUpgrade({
  enabled,
  fileId,
  labels,
  children,
}: {
  enabled: boolean
  fileId: string
  labels: { upgrading: string; hint: string; fail: string }
  children: ReactNode
}) {
  const [phase, setPhase] = useState<'off' | 'run' | 'fail'>(enabled ? 'run' : 'off')
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    if (phase !== 'run') return
    let dead = false
    const tick = setInterval(() => setSecs((s) => s + 1), 1000)
    fetch('/api/ai/summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileId }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`upgrade failed: ${r.status}`)
        return r.json()
      })
      .then(() => {
        if (!dead) window.location.reload()
      })
      .catch(() => {
        if (!dead) setPhase('fail')
      })
      .finally(() => clearInterval(tick))
    return () => {
      dead = true
      clearInterval(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'fail')
    return (
      <>
        <div className="no-print border-b border-line bg-surface px-4 py-2 text-center text-sm text-fg">{labels.fail}</div>
        {children}
      </>
    )

  if (phase !== 'run') return <>{children}</>

  const mm = String(Math.floor(secs / 60))
  const ss = String(secs % 60).padStart(2, '0')
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="spinner" />
      <div className="max-w-md space-y-3">
        <h2 className="text-lg font-semibold text-fg">{labels.upgrading}</h2>
        <p className="muted text-sm leading-relaxed">{labels.hint}</p>
        <p className="font-mono text-2xl font-bold text-fg tabular-nums" aria-live="polite">
          {mm}:{ss}
        </p>
      </div>
    </div>
  )
}
