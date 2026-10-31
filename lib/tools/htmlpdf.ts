'use client'

// HTML → PDF pipeline for the conversion tools (Word, PowerPoint).
//
// Pages are rasterized through html-to-image's foreignObject path, which lets
// the BROWSER itself lay out and shape the text — so Arabic bidi and word
// order inside Word documents and slides come out exactly as on screen
// (html2canvas-style word-by-word drawing would break RTL). The canvas pages
// are then embedded into a pdf-lib document, one PDF page per element.

import { PDFDocument } from 'pdf-lib'
import { download, fmtMB } from './ops'

export type PageSpec = { el: HTMLElement; wPx: number; hPx: number }

async function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.9): Promise<Uint8Array> {
  const ctx = canvas.getContext('2d')!
  // html-to-image produces a transparent canvas — PDF pages need white.
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', quality))
  if (!blob) throw new Error('raster failed')
  return new Uint8Array(await blob.arrayBuffer())
}

async function rasterize(el: HTMLElement, pixelRatio: number): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import('html-to-image')
  try {
    return await toCanvas(el, { pixelRatio, backgroundColor: '#ffffff', cacheBust: false })
  } catch {
    // Font inlining can fail on exotic stylesheets — text still renders with system fonts.
    return await toCanvas(el, { pixelRatio, backgroundColor: '#ffffff', cacheBust: false, skipFonts: true })
  }
}

// Converts prepared page elements into a PDF (1 canvas → 1 full-bleed page).
// Returns the finished PDF bytes so callers can re-download without redoing
// the whole conversion.
export async function pagesToPdf(
  pages: PageSpec[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; count: number }> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length)
    const { el, wPx, hPx } = pages[i]
    const ratio = Math.max(1, Math.min(2.5, 1800 / wPx))
    const canvas = await rasterize(el, ratio)
    const jpg = await canvasToJpegBytes(canvas)
    const img = await doc.embedJpg(jpg)
    const page = doc.addPage([(wPx * 72) / 96, (hPx * 72) / 96])
    page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
    onProgress?.(i + 1, pages.length)
  }
  const bytes = await doc.save()
  return { bytes, count: pages.length }
}

// ---------- flow pagination (Word documents) ----------

const PAGE_W = 794 // A4 @96dpi
const PAGE_H = 1123
const PAD = 56

export type FlowOpts = { styleCss: string; onProgress?: (done: number, total: number) => void }

function host(): { root: HTMLDivElement; dispose: () => void } {
  const root = document.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  root.style.cssText = `position:fixed;left:-99999px;top:0;z-index:-1;background:#fff;`
  document.body.appendChild(root)
  return { root, dispose: () => root.remove() }
}

async function waitForImages(scope: HTMLElement) {
  const imgs = [...scope.querySelectorAll('img')]
  await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => {}))))
}

function newPageEl(css: string, parent?: HTMLElement): { page: HTMLDivElement; inner: HTMLDivElement } {
  const page = document.createElement('div')
  page.style.cssText = `width:${PAGE_W}px;height:${PAGE_H}px;padding:${PAD}px;box-sizing:border-box;overflow:hidden;background:#fff;position:relative;`
  const style = document.createElement('style')
  style.textContent = css
  page.appendChild(style)
  const inner = document.createElement('div')
  inner.style.cssText = `width:${PAGE_W - PAD * 2}px;`
  page.appendChild(inner)
  // Pages MUST live in the document while rasterizing: html-to-image reads
  // layout geometry, and a detached node has none (0×0 canvas → null blob).
  parent?.appendChild(page)
  return { page, inner }
}

// Splits a table that is taller than the available space: trailing body rows
// move to a cloned table (header included) on the next page.
function splitTable(table: HTMLTableElement, maxH: number): HTMLTableElement[] {
  const rows = [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')] as HTMLTableRowElement[]
  if (rows.length < 2) return [table]
  const parts: HTMLTableElement[] = []
  let cur = table.cloneNode(false) as HTMLTableElement
  const thead = table.querySelector(':scope > thead')
  const colgroup = table.querySelector(':scope > colgroup')
  if (thead) cur.appendChild(thead.cloneNode(true))
  if (colgroup) cur.appendChild(colgroup.cloneNode(true))
  const probe = document.createElement('div')
  probe.style.cssText = `width:${PAGE_W - PAD * 2}px;`
  table.parentElement!.insertBefore(probe, table)
  const measure = (t: HTMLElement) => {
    probe.appendChild(t)
    const h = t.getBoundingClientRect().height
    return h
  }
  let h = 0
  for (const row of rows) {
    cur.appendChild(row)
    const rh = measure(cur)
    if (h > 0 && rh > maxH) {
      cur.removeChild(row)
      parts.push(cur)
      probe.innerHTML = ''
      cur = table.cloneNode(false) as HTMLTableElement
      if (thead) cur.appendChild(thead.cloneNode(true))
      if (colgroup) cur.appendChild(colgroup.cloneNode(true))
      cur.appendChild(row)
      h = measure(cur)
    } else {
      h = rh
    }
  }
  if (cur.querySelector('tr')) parts.push(cur)
  probe.remove()
  return parts
}

// Walks top-level nodes and groups them into A4-sized page elements. The
// pages stay attached to an off-screen host until `dispose()` is called —
// rasterize first, clean up after.
export async function paginateFlow(
  html: string,
  opts: FlowOpts,
): Promise<{ pages: HTMLElement[]; dispose: () => void }> {
  const { root, dispose } = host()
  const contentW = PAGE_W - PAD * 2
  const contentH = PAGE_H - PAD * 2
  const measurer = document.createElement('div')
  measurer.style.cssText = `width:${contentW}px;background:#fff;`
  measurer.innerHTML = html
  root.appendChild(measurer)
  await waitForImages(measurer)

  // Clamp oversized standalone images so a photo never fills more than a page.
  for (const img of [...measurer.querySelectorAll('img')] as HTMLImageElement[]) {
    if (img.getBoundingClientRect().height > contentH) {
      img.style.maxHeight = `${contentH}px`
      img.style.width = 'auto'
      img.style.maxWidth = '100%'
    }
  }

  const nodes = [...measurer.childNodes] as HTMLElement[]
  const pages: HTMLElement[] = []
  let page: HTMLDivElement | null = null
  let inner: HTMLDivElement | null = null
  let used = 0

  const flush = () => {
    if (page) pages.push(page)
    page = null
    inner = null
    used = 0
  }
  const place = (node: Node, h: number) => {
    if (!page) ({ page, inner } = newPageEl(opts.styleCss, root))
    inner!.appendChild(node)
    used += h
  }

  const measureHere = (el: HTMLElement) => {
    measurer.appendChild(el)
    const h = el.getBoundingClientRect().height
    measurer.removeChild(el)
    return h
  }

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue
    const el = node as HTMLElement
    let h = 0
    if (el.getBoundingClientRect) h = el.getBoundingClientRect().height
    if (h > contentH && el.tagName === 'TABLE') {
      for (const part of splitTable(el as HTMLTableElement, contentH)) {
        const ph = measureHere(part)
        if (used + ph > contentH) flush()
        place(part, ph)
      }
      continue
    }
    if (used + h > contentH) flush()
    place(node, h)
  }
  flush()
  if (!pages.length) pages.push(newPageEl(opts.styleCss, root).page)
  opts.onProgress?.(0, pages.length)
  return { pages, dispose }
}

export function fmtSize(bytes: Uint8Array): string {
  return fmtMB(bytes.length)
}
