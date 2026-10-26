'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function AutoPrint({
  backHref,
  labels,
}: {
  backHref: string
  labels: { print: string; hint: string; back: string }
}) {
  useEffect(() => {
    let cancelled = false
    const go = () => {
      if (!cancelled) setTimeout(() => !cancelled && window.print(), 400)
    }
    if (document.fonts?.ready) document.fonts.ready.then(go)
    else go()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 text-fg">
      <Link href={backHref} className="btn btn-ghost btn-sm">{labels.back}</Link>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>{labels.print}</button>
      <span className="muted text-sm">{labels.hint}</span>
    </div>
  )
}
