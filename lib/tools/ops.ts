'use client'

// Core PDF operations for the tools page — every one of them runs entirely
// in the browser with pdf-lib: nothing is ever uploaded to a server.

import { PDFDocument } from 'pdf-lib'

export const A4: [number, number] = [595.28, 841.89] // pt

export function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)
}

// ---------- downloading ----------

export function download(data: Uint8Array | Blob, name: string, type = 'application/pdf') {
  const part = (data instanceof Uint8Array ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data) as BlobPart
  const url = URL.createObjectURL(new Blob([part], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').slice(0, 60) || 'file'
}

// ---------- page range parsing ----------

// Accepts "1-3, 5, 8-10" (latin or arabic-indic digits), 1-based inclusive.
export function parseRanges(input: string, max: number): number[] {
  const norm = input
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  const out = new Set<number>()
  for (const part of norm.split(/[,،\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/)
    if (!m) throw new Error('range')
    const a = parseInt(m[1], 10)
    const b = m[2] ? parseInt(m[2], 10) : a
    if (a < 1 || b < a || b > max) throw new Error('range')
    for (let i = a; i <= b; i++) out.add(i)
  }
  return [...out].sort((x, y) => x - y)
}

// ---------- merge ----------

export type InputFile = { name: string; bytes: Uint8Array }

export async function mergePdfs(files: InputFile[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const f of files) {
    const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true })
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  return out.save({ useObjectStreams: true })
}

// ---------- extract / remove ----------

export async function keepPages(bytes: Uint8Array, keep: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, keep.map((n) => n - 1))
  pages.forEach((p) => out.addPage(p))
  return out.save({ useObjectStreams: true })
}

// ---------- split ----------

export type SplitMode =
  | { kind: 'range'; pages: number[] }
  | { kind: 'each' }
  | { kind: 'everyN'; n: number }

export async function splitPdf(
  bytes: Uint8Array,
  base: string,
  mode: SplitMode,
): Promise<{ name: string; bytes: Uint8Array }[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const total = src.getPageCount()
  const chunks: number[][] = []
  if (mode.kind === 'range') {
    chunks.push(mode.pages)
  } else if (mode.kind === 'each') {
    for (let i = 1; i <= total; i++) chunks.push([i])
  } else {
    const n = Math.max(1, Math.min(mode.n, total))
    for (let start = 1; start <= total; start += n) {
      const pages: number[] = []
      for (let p = start; p < start + n && p <= total; p++) pages.push(p)
      chunks.push(pages)
    }
  }
  const items: { name: string; bytes: Uint8Array }[] = []
  for (const chunk of chunks) {
    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, chunk.map((p) => p - 1))
    pages.forEach((p) => out.addPage(p))
    const label = chunk.length === 1 ? `p${chunk[0]}` : `p${chunk[0]}-${chunk[chunk.length - 1]}`
    items.push({ name: `${base}-${label}.pdf`, bytes: await out.save({ useObjectStreams: true }) })
  }
  return items
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return src.getPageCount()
}

// ---------- images → PDF ----------

// EXIF orientation of a JPEG (1 = normal) by reading its TIFF header.
function jpegOrientation(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1
  let off = 2
  while (off + 4 < b.length) {
    if (b[off] !== 0xff) { off++; continue }
    const marker = b[off + 1]
    const size = (b[off + 2] << 8) | b[off + 3]
    if (marker === 0xe1 && off + 4 < b.length && b[off + 4] === 0x45 /* E */ && b[off + 5] === 0x78 /* x */) {
      const tiff = off + 10
      const le = b[tiff] === 0x49
      const u16 = (o: number) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
      let ifd = tiff + ((le ? b[tiff + 4] | (b[tiff + 5] << 8) : (b[tiff + 4] << 8) | b[tiff + 5]))
      const entries = u16(ifd)
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12
        if (u16(e) === 0x0112) return u16(e + 8) || 1
      }
    }
    if (marker === 0xda) break // start of scan — EXIF must come before it
    off += 2 + size
  }
  return 1
}

// Decodes any image the browser understands and returns JPEG bytes with EXIF
// orientation applied. Returns null for already-clean JPEGs (no re-encoding).
async function normalizeImage(bytes: Uint8Array, type: string): Promise<Uint8Array | null> {
  if (type === 'image/jpeg') {
    const o = jpegOrientation(bytes)
    if (o === 1) return null // perfect as-is — embed the original bytes
  }
  const blob = new Blob([bytes as unknown as BlobPart], { type })
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const bin = atob(dataUrl.split(',')[1])
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export type ImagePage = 'a4' | 'a4l' | 'auto'

export async function imagesToPdf(
  images: { name: string; bytes: Uint8Array; type: string }[],
  page: ImagePage,
  onProgress?: (i: number, n: number) => void,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    onProgress?.(i, images.length)
    // null = a clean JPEG that can be embedded byte-for-byte, no re-encoding
    const norm = await normalizeImage(img.bytes, img.type)
    const embedded = norm === null ? await doc.embedJpg(img.bytes) : await doc.embedJpg(norm)
    const iw = embedded.width
    const ih = embedded.height
    if (page === 'auto') {
      const p = doc.addPage([iw, ih])
      p.drawImage(embedded, { x: 0, y: 0, width: iw, height: ih })
    } else {
      const land = page === 'a4l' || (page === 'a4' && iw > ih)
      const pw = land ? A4[1] : A4[0]
      const ph = land ? A4[0] : A4[1]
      const m = 24 // ~8.5mm margin
      const s = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih)
      const w = iw * s
      const h = ih * s
      const p = doc.addPage([pw, ph])
      p.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h })
    }
  }
  onProgress?.(images.length, images.length)
  return doc.save({ useObjectStreams: true })
}

// ---------- zip ----------

export async function zipOf(items: { name: string; bytes: Uint8Array }[]): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (const it of items) zip.file(it.name, it.bytes)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

// ---------- misc ----------

export function looksPdf(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
}
