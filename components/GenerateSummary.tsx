'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function GenerateSummary({
  fileId,
  labels,
}: {
  fileId: string
  labels: { summarize: string; summarizing: string }
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/api/ai/summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileId }),
      })
      const j = (await r.json().catch(() => null)) as { error?: string } | null
      if (!r.ok) throw new Error(j?.error ?? 'Failed')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <button type="button" disabled={busy} onClick={run} className="btn btn-teal">
        {busy ? labels.summarizing : labels.summarize}
      </button>
      {err && (
        <p role="alert" className="text-sm text-red-400">
          {err}
        </p>
      )}
    </div>
  )
}
