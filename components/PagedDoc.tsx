'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { PRINT_CSS } from '@/lib/printCss'

// Safety net for the Paged.js engine: if pagination silently stops early (known
// failure mode with huge/unbreakable blocks), the rendered text is compared with
// the source and the document falls back to the browser's own print engine —
// which always produces the complete content.
const FALLBACK_CSS = `
@page { size: A4; margin: 16mm 14mm; }
.doc-cover { height: 240mm; }
.cover-mark { margin-top: 40mm; }
.doc-cover, .doc-toc { page-break-after: always; }
.doc-body { break-before: auto; }
.doc-toc .pg { display: none; }
`

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
    const toFallback = (reason: string) => {
      if (cancelled) return
      console.warn('paged.js fallback:', reason)
      // Drop any partial pages the engine already produced, then keep clearing
      // briefly in case the abandoned chunker appends late fragments.
      if (out.current) out.current.innerHTML = ''
      const re = [1500, 4000].map((ms) => setTimeout(() => {
        if (!cancelled && out.current) out.current.innerHTML = ''
      }, ms))
      const st = document.createElement('style')
      st.textContent = FALLBACK_CSS
      document.head.appendChild(st)
      setState('fallback')
    }
    ;(async () => {
      try {
        await (document.fonts?.ready ?? Promise.resolve())
        // Vendored self-contained ESM build (see lib/vendor/paged.esm.js header):
        // the package's src entry pulls legacy polyfills that break under Turbopack
        // and silently kill pagination.
        const { Previewer } = await import('@/lib/vendor/paged.esm.js')
        if (cancelled || !src.current || !out.current) return
        const frag = document.createDocumentFragment()
        Array.from(src.current.childNodes).forEach((n) => frag.appendChild(n.cloneNode(true)))
        const previewing = new Previewer().preview(frag, [{ 'doc.css': PRINT_CSS }], out.current)
        // A stuck chunker must never leave the user waiting forever.
        const timeout = new Promise((_, rej) =>
          setTimeout(() => rej(new Error('pagination timed out')), 180000),
        )
        await Promise.race([previewing, timeout])
        if (cancelled) return
        // Completeness check: the rendered pages must carry (almost) all of the
        // source text, otherwise the PDF would ship truncated.
        const pages = out.current.querySelectorAll('.pagedjs_page').length
        const srcLen = (src.current.textContent ?? '').replace(/\s+/g, '').length
        const outLen = (out.current.textContent ?? '').replace(/\s+/g, '').length
        if (!pages || (srcLen > 1500 && outLen < srcLen * 0.8)) {
          throw new Error(`incomplete render: ${pages} pages, ${outLen}/${srcLen} chars`)
        }
        setState('ready')
      } catch (e) {
        toFallback(e instanceof Error ? e.message : 'unknown error')
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
