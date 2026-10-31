'use client'

// Lazy pdf.js loader for the PDF tools. The worker ships as a same-origin
// static file (public/pdfjs/) — the same self-hosting philosophy as the
// ffmpeg engine in public/ffmpeg/ — so the tools work even on networks
// where public CDNs are blocked.

type PdfjsModule = typeof import('pdfjs-dist')

let mod: PdfjsModule | null = null

export async function getPdfjs(): Promise<PdfjsModule> {
  if (!mod) {
    mod = await import('pdfjs-dist')
    mod.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
  }
  return mod
}

export type Thumb = { index: number; url: string; w: number; h: number }

// Renders page thumbnails sequentially and streams each one back through
// `onThumb` as soon as it is ready (so the grid fills up progressively).
// pdf.js takes ownership of the buffer it receives, so callers must pass a
// copy — done here via slice() to make it impossible to forget.
export async function renderThumbs(
  bytes: Uint8Array,
  maxW: number,
  onThumb: (t: Thumb) => void,
  onProgress?: (done: number, total: number) => void,
  signal?: { cancelled: boolean },
): Promise<void> {
  const pdfjs = await getPdfjs()
  const task = pdfjs.getDocument({ data: bytes.slice() })
  const doc = await task.promise
  const total = doc.numPages
  for (let i = 1; i <= total; i++) {
    if (signal?.cancelled) break
    const page = await doc.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(maxW / base.width, 2) // never upscale past 2× for crispness
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(vp.width)
    canvas.height = Math.ceil(vp.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
    onThumb({ index: i, url: canvas.toDataURL('image/jpeg', 0.75), w: base.width, h: base.height })
    onProgress?.(i, total)
  }
  await task.destroy() // also terminates the worker when it is not needed
}
