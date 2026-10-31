// Server-side text extraction for modern Office files, used by the AI
// transcriber (/api/ai/transcribe). Purely additive: every existing path
// (media/pdf/image/text) is untouched — this module only runs when the
// uploaded file is a .docx or .pptx.
//
// - DOCX: mammoth's Node API extracts the raw text (paragraphs separated
//   by newlines), which then flows through the exact same text pipeline
//   used for .txt/.md uploads (splitText → chunked Gemini requests).
// - PPTX: JSZip opens the OOXML package and pulls the text runs out of
//   ppt/slides/slideN.xml in slide order, one line per paragraph, so the
//   model sees the deck the same way a student reads it.

import mammoth from 'mammoth'
import JSZip from 'jszip'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export function isOffice(name: string, mime: string | null): boolean {
  const m = (mime ?? '').toLowerCase()
  const n = name.toLowerCase()
  return (
    /\.docx$/.test(n) ||
    /\.pptx$/.test(n) ||
    m === DOCX_MIME ||
    m === PPTX_MIME
  )
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')

// One slide XML → one text block. Every <a:p>…</a:p> is a paragraph; the
// <a:t> runs inside it are concatenated in document order.
function slideText(xml: string): string {
  const paras = xml.split(/<a:p[ >]/).slice(1).map((p) => p.split('</a:p>')[0])
  const lines: string[] = []
  for (const p of paras) {
    const runs = [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((r) => decodeXml(r[1]))
    const line = runs.join('').replace(/\s+/g, ' ').trim()
    if (line) lines.push(line)
  }
  return lines.join('\n')
}

// Returns the plain text of a DOCX/PPTX buffer, or null when the file is
// neither (callers then fall back to their existing handling).
export async function extractOfficeText(
  name: string,
  mime: string | null,
  buf: ArrayBuffer
): Promise<string | null> {
  const m = (mime ?? '').toLowerCase()
  const n = name.toLowerCase()
  const isDocx = /\.docx$/.test(n) || m === DOCX_MIME
  const isPptx = /\.pptx$/.test(n) || m === PPTX_MIME
  if (!isDocx && !isPptx) return null

  if (isDocx) {
    const res = await mammoth.extractRawText({ buffer: Buffer.from(buf) })
    return res.value
  }

  const zip = await JSZip.loadAsync(buf)
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)![1])
      const nb = Number(b.match(/slide(\d+)\.xml/)![1])
      return na - nb
    })
  const blocks: string[] = []
  for (let i = 0; i < slides.length; i++) {
    const xml = await zip.files[slides[i]].async('string')
    const txt = slideText(xml)
    if (txt) blocks.push(`— سلايد ${i + 1} —\n${txt}`)
  }
  return blocks.join('\n\n')
}
