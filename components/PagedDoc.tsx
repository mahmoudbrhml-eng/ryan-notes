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
  docKind,
  labels,
  children,
}: {
  backHref: string
  filename: string
  docKind?: string
  labels: { print: string; hint: string; back: string; building: string; again: string; save: string; saved: string }
  children: ReactNode
}) {
  const src = useRef<HTMLDivElement>(null)
  const out = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'working' | 'ready' | 'fallback'>('working')
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const autoTried = useRef(false)
  const saving = useRef(false)
  // Render facts kept for the telemetry report (the source unmounts when ready).
  const stats = useRef<{ srcLen: number; outLen: number; pages: number } | null>(null)
  const html2canvasRef = useRef<((el: HTMLElement, o: Record<string, unknown>) => Promise<HTMLCanvasElement>) | null>(null)

  // One report per download attempt: which engine ran, how complete the output
  // was, on which device — no more guessing when a user reports a broken PDF.
  // Telemetry must never break or delay the download itself.
  const report = (r: { ok: boolean; mode: 'paged' | 'fallback'; pages: number; srcLen: number; outLen: number; ms: number; err?: string }) => {
    void fetch('/api/pdf-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ doc: docKind ?? 'unknown', ...r }),
    }).catch(() => {})
  }

  // A page/window raster must never exceed what a phone's GPU can hold: two
  // attempts, the second at a gentler scale, then fail loudly (never silently).
  const grab = async (el: HTMLElement, crop: { x?: number; y?: number; width?: number; height?: number } = {}) => {
    let last: unknown
    for (const scale of [2, 1.4]) {
      try {
        return await html2canvasRef.current!(el, { ...crop, scale, backgroundColor: '#ffffff', useCORS: true, logging: false })
      } catch (e) {
        last = e
      }
    }
    throw last instanceof Error ? last : new Error('capture failed')
  }

  const download = async () => {
    if (saving.current) return
    saving.current = true
    setSave('saving')
    const t0 = Date.now()
    try {
      const [{ jsPDF }, h2c] = await Promise.all([import('jspdf'), import('html2canvas-pro')])
      html2canvasRef.current = h2c.default as unknown as (el: HTMLElement, o: Record<string, unknown>) => Promise<HTMLCanvasElement>
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true })
      const mode: 'paged' | 'fallback' = state === 'fallback' ? 'fallback' : 'paged'
      let pageCount = 0
      let srcLen = stats.current?.srcLen ?? 0
      let outLen = stats.current?.outLen ?? 0
      if (state === 'ready' && out.current) {
        const pages = Array.from(out.current.querySelectorAll('.pagedjs_page')) as HTMLElement[]
        if (pages.length === 0) throw new Error('no pages rendered')
        pageCount = pages.length
        for (let i = 0; i < pages.length; i++) {
          const canvas = await grab(pages[i])
          if (i > 0) pdf.addPage()
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, A4_W, A4_H, undefined, 'FAST')
          canvas.width = 0
          canvas.height = 0
          await new Promise((r) => setTimeout(r, 0)) // let the GC keep up on long documents
        }
      } else if (src.current) {
        // Fallback mode: the flowing document is captured WINDOW BY WINDOW —
        // one small A4-sized canvas per page. The old approach rendered the
        // whole document into a single giant canvas, and phone browsers
        // silently clip canvases beyond a few million pixels: a full lecture
        // arrived as a 3-page stub. Small window captures work on every device.
        const el = src.current
        const rect = el.getBoundingClientRect()
        if (rect.width < 40) throw new Error('layout not ready')
        const left = rect.left + window.scrollX
        const top = rect.top + window.scrollY
        const elW = Math.ceil(rect.width)
        const winH = Math.max(200, Math.round(elW * (A4_H / A4_W)))
        const total = Math.max(1, Math.ceil(el.scrollHeight / winH))
        pageCount = total
        srcLen = (el.textContent ?? '').replace(/\s+/g, '').length
        outLen = srcLen
        for (let i = 0; i < total; i++) {
          const h = Math.min(winH, el.scrollHeight - i * winH)
          const canvas = await grab(el, { x: left, y: top + i * winH, width: elW, height: Math.ceil(h) })
          if (i > 0) pdf.addPage()
          pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, A4_W, (h / elW) * A4_W, undefined, 'FAST')
          canvas.width = 0
          canvas.height = 0
          await new Promise((r) => setTimeout(r, 0))
        }
      } else throw new Error('nothing to render')
      pdf.save(safeName(filename))
      setSave('saved')
      report({ ok: true, mode, pages: pageCount, srcLen, outLen, ms: Date.now() - t0 })
    } catch (e) {
      console.warn('pdf save failed:', e)
      setSave('failed')
      report({
        ok: false,
        mode: state === 'fallback' ? 'fallback' : 'paged',
        pages: 0,
        srcLen: 0,
        outLen: 0,
        ms: Date.now() - t0,
        err: e instanceof Error ? e.message.slice(0, 160) : 'unknown',
      })
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
        if (!pages || (srcLen > 1500 && outLen < srcLen * 0.92)) {
          throw new Error(`incomplete render: ${pages} pages, ${outLen}/${srcLen} chars`)
        }
        stats.current = { srcLen, outLen, pages }
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
