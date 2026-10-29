'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { PRINT_CSS } from '@/lib/printCss'

// Safety net for the Paged.js engine: if pagination silently stops early (known
// failure mode with huge/unbreakable blocks), the rendered text is compared with
// the source and the document falls back to the browser's own flow layout —
// which always produces the complete content (rasterized page by page below).
const FALLBACK_CSS = `
@page { size: A4; margin: 16mm 14mm; }
.doc-cover { height: 240mm; }
.cover-mark { margin-top: 40mm; }
.doc-cover, .doc-toc { page-break-after: always; }
.doc-body { break-before: auto; }
.doc-toc .pg { display: none; }
`

const A4_W = 595.28 // pt
const A4_H = 841.89 // pt
const safeName = (n: string) => `${(n || 'ryan-notes').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'ryan-notes'}.pdf`

// Builds the paginated document in the browser (cover, contents with page numbers,
// running header/footer) and then saves it as a real PDF file automatically —
// the user never sees a print dialog. A manual re-download button and a classic
// paper-print option stay available in the toolbar.
export default function PagedDoc({
  backHref,
  filename,
  labels,
  children,
}: {
  backHref: string
  filename: string
  labels: { print: string; hint: string; back: string; building: string; again: string; save: string; saved: string }
  children: ReactNode
}) {
  const src = useRef<HTMLDivElement>(null)
  const out = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'working' | 'ready' | 'fallback'>('working')
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const autoTried = useRef(false)
  const saving = useRef(false)

  const download = async () => {
    if (saving.current) return
    saving.current = true
    setSave('saving')
    try {
      const [{ jsPDF }, h2c] = await Promise.all([import('jspdf'), import('html2canvas-pro')])
      const html2canvas = h2c.default
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true })
      if (state === 'ready' && out.current) {
        const pages = Array.from(out.current.querySelectorAll('.pagedjs_page'))
        if (pages.length === 0) throw new Error('no pages rendered')
        for (let i = 0; i < pages.length; i++) {
          const canvas = await html2canvas(pages[i] as HTMLElement, {
            scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
          })
          if (i > 0) pdf.addPage()
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, A4_W, A4_H, undefined, 'FAST')
          canvas.width = 0
          canvas.height = 0
          await new Promise((r) => setTimeout(r, 0)) // let the GC keep up on long documents
        }
      } else if (src.current) {
        // Fallback mode: one tall flowing document, sliced into A4-sized pages.
        const canvas = await html2canvas(src.current, {
          scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
        })
        const sliceH = Math.max(1, Math.floor(canvas.width * (A4_H / A4_W)))
        const n = Math.max(1, Math.ceil(canvas.height / sliceH))
        for (let i = 0; i < n; i++) {
          const h = Math.min(sliceH, canvas.height - i * sliceH)
          const c = document.createElement('canvas')
          c.width = canvas.width
          c.height = h
          const ctx = c.getContext('2d')
          if (!ctx) throw new Error('canvas unavailable')
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, c.width, h)
          ctx.drawImage(canvas, 0, i * sliceH, canvas.width, h, 0, 0, canvas.width, h)
          if (i > 0) pdf.addPage()
          pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, A4_W, (h / canvas.width) * A4_W, undefined, 'FAST')
          c.width = 0
          c.height = 0
          await new Promise((r) => setTimeout(r, 0))
        }
        canvas.width = 0
        canvas.height = 0
      } else throw new Error('nothing to render')
      pdf.save(safeName(filename))
      setSave('saved')
    } catch (e) {
      console.warn('pdf save failed:', e)
      setSave('failed')
    } finally {
      saving.current = false
    }
  }

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

  // The whole point of this page: click "download" in the app → the PDF file lands
  // in the user's downloads folder by itself, no print dialog involved.
  useEffect(() => {
    if (state === 'working' || autoTried.current) return
    autoTried.current = true
    const id = setTimeout(() => void download(), 700)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const busy = state === 'working' || save === 'saving'
  return (
    <>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 text-fg">
        <Link href={backHref} className="btn btn-ghost btn-sm">{labels.back}</Link>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void download()}>
          {busy && <span className="spinner" />}
          {state === 'working' || save === 'saving' ? labels.building : save === 'saved' ? labels.again : labels.print}
        </button>
        {state !== 'working' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>{labels.save}</button>
        )}
        <span className="muted text-sm" role="status">
          {save === 'saved' ? labels.saved : save === 'failed' ? labels.hint : state !== 'working' ? labels.hint : ''}
        </span>
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
