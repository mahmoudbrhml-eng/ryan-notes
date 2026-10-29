'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { PRINT_CSS } from '@/lib/printCss'

// Paginates the document in the browser (cover, contents with page numbers, running header/footer)
// and then opens the print dialog so the user can save it as a PDF.
export default function PagedDoc({
  backHref,
  labels,
  children,
}: {
  backHref: string
  labels: { print: string; hint: string; back: string; building: string }
  children: ReactNode
}) {
  const src = useRef<HTMLDivElement>(null)
  const out = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'working' | 'ready' | 'fallback'>('working')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await (document.fonts?.ready ?? Promise.resolve())
        const { Previewer } = await import('pagedjs')
        if (cancelled || !src.current || !out.current) return
        const frag = document.createDocumentFragment()
        Array.from(src.current.childNodes).forEach((n) => frag.appendChild(n.cloneNode(true)))
        await new Previewer().preview(frag, [{ 'doc.css': PRINT_CSS }], out.current)
        if (!cancelled) setState('ready')
      } catch {
        if (cancelled) return
        const st = document.createElement('style')
        st.textContent = '@page { size: A4; margin: 16mm 14mm; }'
        document.head.appendChild(st)
        setState('fallback')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (state === 'working') return
    const id = setTimeout(() => window.print(), 700)
    return () => clearTimeout(id)
  }, [state])

  return (
    <>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 text-fg">
        <Link href={backHref} className="btn btn-ghost btn-sm">{labels.back}</Link>
        <button type="button" className="btn btn-primary btn-sm" disabled={state === 'working'} onClick={() => window.print()}>
          {state === 'working' && <span className="spinner" />}
          {state === 'working' ? labels.building : labels.print}
        </button>
        <span className="muted text-sm">{labels.hint}</span>
      </div>

      <div ref={out} />
      {/* The source is removed once the pages are built, so each heading id exists only once (links in the PDF work). */}
      {state !== 'ready' && (
        <div ref={src} hidden={state === 'working'} className={state === 'fallback' ? 'doc-page' : undefined}>
          {children}
        </div>
      )}
    </>
  )
}
