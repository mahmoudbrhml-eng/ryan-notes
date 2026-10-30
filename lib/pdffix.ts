import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib'
import { deflateSync } from 'node:zlib'

// Post-processor for Chromium-generated PDFs: makes the TEXT LAYER (what
// copy/paste, search and OCR tools read) match the visible text.
//
// Why this is needed: Skia embeds our variable Cairo font as Type 3 fonts and
// writes per-glyph ToUnicode entries in ARABIC PRESENTATION FORMS (U+FBxx–
// U+FExx), skips some ligature glyphs entirely (lam-alef), and wraps clusters
// in ActualText spans. PDF text extractors (poppler / MuPDF / PDFium — the
// engines behind pdftotext, OCR pipelines, and browser viewers) reverse RTL
// runs, so presentation-form ligature entries come out with swapped letter
// pairs ("سرطان" → "رسطان", "الخلايا" → "الخاليا") and missing glyphs become
// wrong characters. This module rewrites the ToUnicode CMaps to logical base
// letters (stored in visual order so the extractor's RTL reversal restores
// them), fills/corrects entries from the ActualText spans Chromium already
// embedded, and neutralises those spans so every engine reads one consistent
// text layer. Visual rendering is untouched.

const isPresentation = (ch: string) =>
  (ch >= '\uFB50' && ch <= '\uFDFF') || (ch >= '\uFE70' && ch <= '\uFEFF')
const isArabic = (ch: string) =>
  (ch >= '\u0600' && ch <= '\u06FF') || isPresentation(ch)

// Combining tashkeel marks: stripped from the TEXT LAYER only (the visible
// rendering keeps them). Hamza-carrying letters survive because NFC composes
// them back into single letters before this strip runs.
const isTashkeel = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0
  return (c >= 0x064b && c <= 0x065f) || c === 0x0670
}

/** Store-form text for a CMap destination: NFKD → NFC → strip tashkeel →
 *  reverse multi-char strings (extractors reverse RTL runs once, restoring
 *  logical order). Returns null when the text is not Arabic (keep as-is). */
function toLayerText(s: string): string | null {
  if (!s || !Array.from(s).some(isArabic)) return null
  s = s.normalize('NFKD').normalize('NFC')
  s = Array.from(s)
    .filter((c) => !isTashkeel(c))
    .join('')
  if (!s) return ''
  if (Array.from(s).length > 1) s = Array.from(s).reverse().join('')
  return s
}

const utf16beHex = (s: string) =>
  Array.from(s)
    .flatMap((c) => {
      const cp = c.codePointAt(0)!
      return cp > 0xffff
        ? [((cp - 0x10000) >> 10) + 0xd800, (cp & 0x3ff) + 0xdc00]
        : [cp]
    })
    .map((cp) => cp.toString(16).padStart(4, '0').toUpperCase())
    .join('')

function hexToText(hex: string): string | null {
  if (hex.length % 4 !== 0) return null
  let s = ''
  for (let i = 0; i < hex.length; i += 4) {
    s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
  }
  return s
}

type Entries = Map<string, string> // glyph code (uppercase hex, per codeWidth) → raw CMap text

function parseCMap(cmap: string): { entries: Entries; codeWidth: number } {
  const entries: Entries = new Map()
  let codeWidth = 2
  const put = (codeHex: string, text: string) => {
    if (!/^[0-9A-F]+$/.test(codeHex)) return
    if (codeHex.length >= 4) codeWidth = 4
    entries.set(codeHex.toUpperCase(), text)
  }
  let m: RegExpExecArray | null
  const bf = /beginbfchar([\s\S]*?)endbfchar/g
  while ((m = bf.exec(cmap))) {
    const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g
    let p: RegExpExecArray | null
    while ((p = pair.exec(m[1]))) {
      const t = hexToText(p[2])
      if (t !== null) put(p[1], t)
    }
  }
  const br = /beginbfrange([\s\S]*?)endbfrange/g
  while ((m = br.exec(cmap))) {
    const body = m[1]
    const arr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]*)\]/g
    let a: RegExpExecArray | null
    while ((a = arr.exec(body))) {
      const lo = parseInt(a[1], 16)
      const items = a[3].match(/<([0-9A-Fa-f]*)>/g) ?? []
      items.forEach((it, i) => {
        const t = hexToText(it.slice(1, -1))
        if (t !== null) {
          const code = (lo + i).toString(16).toUpperCase()
          put(code, t)
        }
      })
    }
    const body2 = body.replace(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[[^\]]*\]/g, '')
    const tri = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g
    let t3: RegExpExecArray | null
    while ((t3 = tri.exec(body2))) {
      const lo = parseInt(t3[1], 16)
      const hi = parseInt(t3[2], 16)
      if (hi < lo || hi - lo > 255) continue
      const base = hexToText(t3[3])
      if (base === null) continue
      const cps = Array.from(base)
      for (let c = lo; c <= hi; c++) {
        const last = String.fromCodePoint((cps[cps.length - 1]?.codePointAt(0) ?? 0) + (c - lo))
        const text = cps.slice(0, -1).join('') + last
        put(c.toString(16).toUpperCase(), text)
      }
    }
  }
  return { entries, codeWidth }
}

function buildCMapSections(entries: Entries): string {
  const codes = [...entries.keys()].sort()
  const parts: string[] = []
  for (let i = 0; i < codes.length; i += 100) {
    const chunk = codes.slice(i, i + 100)
    parts.push(
      `${chunk.length} beginbfchar\n` +
        chunk
          .map((code) => `<${code}> <${utf16beHex(entries.get(code) ?? '')}>`)
          .join('\n') +
        `\nendbfchar`,
    )
  }
  return parts.join('\n')
}

function streamText(stream: PDFRawStream): string {
  try {
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
  } catch {
    return Buffer.from(stream.getContents()).toString('latin1')
  }
}

/** Replace a stream's bytes; content streams stay Flate-compressed. */
function setStreamText(stream: PDFRawStream, text: string) {
  const raw = Buffer.from(text, 'latin1')
  const compressed = deflateSync(raw, { level: 9 })
  const useCompressed = compressed.length < raw.length
  const bytes = useCompressed ? compressed : raw
  const dict = stream.dict
  if (useCompressed) {
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
    dict.delete(PDFName.of('DecodeParms'))
  } else {
    dict.delete(PDFName.of('Filter'))
    dict.delete(PDFName.of('DecodeParms'))
  }
  dict.set(PDFName.of('Length'), PDFNumber.of(bytes.length))
  ;(stream as unknown as { contents: Uint8Array }).contents = new Uint8Array(bytes)
}

type GlyphEvent = { fontKey: string; code: string; width: number }

type Span = { text: string; glyphs: GlyphEvent[] }

function parseSpans(
  content: string,
  nameToFont: Map<string, { key: string; width: number }>,
): Span[] {
  const spans: Span[] = []
  const span = /\/Span\s*<<[^>]*?\/ActualText\s*<([0-9A-Fa-f]+)>\s*>>\s*BDC([\s\S]*?)EMC/g
  let m: RegExpExecArray | null
  while ((m = span.exec(content))) {
    let text = hexToText(m[1]) ?? ''
    if (text.startsWith('\uFEFF')) text = text.slice(1)
    const glyphs: GlyphEvent[] = []
    let curFont: string | null = null
    const op = /\/(F\d+)[^\n]*?Tf|<([0-9A-Fa-f]+)>\s*Tj/g
    let o: RegExpExecArray | null
    while ((o = op.exec(m[2]))) {
      if (o[1]) {
        curFont = '/' + o[1]
      } else if (curFont) {
        const f = nameToFont.get(curFont)
        if (f) {
          const hex = o[2]
          const w = f.width
          if (hex.length % w === 0) {
            for (let i = 0; i < hex.length; i += w) {
              glyphs.push({ fontKey: f.key, code: hex.slice(i, i + w).toUpperCase(), width: w })
            }
          }
        }
      }
    }
    spans.push({ text, glyphs })
  }
  return spans
}

const normForCompare = (s: string) =>
  Array.from(s.normalize('NFKD').normalize('NFC'))
    .filter((c) => !isTashkeel(c))
    .join('')

export async function fixArabicTextLayer(
  pdfBytes: Uint8Array,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const ctx = doc.context

  const pages: PDFDict[] = []
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && String(obj.get(PDFName.of('Type'))) === '/Page') {
      pages.push(obj)
    }
  }

  type FontState = {
    entries: Entries
    width: number
    toUnicode: PDFRawStream | null
    original: string
  }
  const fonts = new Map<string, FontState>() // key: "objNum genNum" or "inline-n"

  const loadFont = (fontDict: PDFDict): { key: string; width: number } | null => {
    const ref = ctx.getObjectRef(fontDict)
    const key = ref ? `${ref.objectNumber} ${ref.generationNumber}` : `inline-${fonts.size}`
    const existing = fonts.get(key)
    if (existing) return { key, width: existing.width }
    const tuObj = fontDict.lookup(PDFName.of('ToUnicode'))
    const tu = tuObj instanceof PDFRawStream ? tuObj : null
    const original = tu ? streamText(tu) : ''
    const { entries, codeWidth } = original ? parseCMap(original) : { entries: new Map(), codeWidth: 2 }
    fonts.set(key, { entries, width: codeWidth, toUnicode: tu ?? null, original })
    return { key, width: codeWidth }
  }

  const contentStreamsOf = (page: PDFDict): PDFRawStream[] => {
    const parts: PDFRawStream[] = []
    const contents = page.lookup(PDFName.of('Contents'))
    if (contents instanceof PDFRawStream) {
      parts.push(contents)
    } else if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const el = contents.lookup(i)
        if (el instanceof PDFRawStream) parts.push(el)
      }
    }
    return parts
  }

  // --- pass 1: collect fonts, then fill/correct entries from ActualText spans ---
  for (const page of pages) {
    const res = page.lookupMaybe(PDFName.of('Resources'), PDFDict)
    if (!res) continue
    const fontDicts = res.lookupMaybe(PDFName.of('Font'), PDFDict)
    if (!fontDicts) continue
    const nameToFont = new Map<string, { key: string; width: number }>()
    for (const name of fontDicts.keys()) {
      const fd = fontDicts.lookupMaybe(name, PDFDict)
      if (!fd) continue
      const loaded = loadFont(fd)
      if (loaded) nameToFont.set(name.asString(), loaded)
    }
    for (const part of contentStreamsOf(page)) {
      const text = streamText(part)
      if (!text.includes('/ActualText')) continue
      for (const span of parseSpans(text, nameToFont)) {
        const known: GlyphEvent[] = []
        const unknown: GlyphEvent[] = []
        for (const g of span.glyphs) {
          const st = fonts.get(g.fontKey)
          ;(st && st.entries.has(g.code) ? known : unknown).push(g)
        }
        if (unknown.length === 0) {
          // single-glyph span: span text is the ground truth for that glyph
          if (span.glyphs.length === 1 && span.text) {
            const g = span.glyphs[0]
            const st = fonts.get(g.fontKey)!
            const cur = normForCompare(st.entries.get(g.code) ?? '')
            const want = normForCompare(span.text)
            if (cur !== want) st.entries.set(g.code, span.text)
          }
          continue
        }
        if (unknown.length !== 1 || !span.text) continue
        // fill the only unknown glyph with the span text minus known chars
        const wantN = Array.from(normForCompare(span.text))
        for (const k of known) {
          const st = fonts.get(k.fontKey)!
          for (const ch of Array.from(normForCompare(st.entries.get(k.code) ?? ''))) {
            const i = wantN.indexOf(ch)
            if (i >= 0) wantN.splice(i, 1)
          }
        }
        const fill = wantN.join('')
        if (fill) fonts.get(unknown[0].fontKey)!.entries.set(unknown[0].code, fill)
      }
    }
  }

  // --- pass 2: rewrite ToUnicode CMaps with layer-normalised entries ---
  for (const [, st] of fonts) {
    if (!st.toUnicode || !st.original || st.entries.size === 0) continue
    const layer: Entries = new Map()
    for (const [code, text] of st.entries) {
      layer.set(code, toLayerText(text) ?? text)
    }
    const sections = buildCMapSections(layer)
    if (!sections) continue
    const headMatch = st.original.match(/^[\s\S]*?endcodespacerange\s*\n?/)
    const head = headMatch ? headMatch[0] : ''
    const tailIdx = st.original.lastIndexOf('endcmap')
    const tail = tailIdx >= 0 ? st.original.slice(tailIdx) : 'endcmap CMapName currentdict /CMap defineresource pop end end'
    setStreamText(st.toUnicode, head + sections + '\n' + tail)
  }

  // --- pass 3: neutralise ActualText spans so all engines read the fixed layer ---
  for (const page of pages) {
    for (const part of contentStreamsOf(page)) {
      const text = streamText(part)
      if (!text.includes('/ActualText')) continue
      const fixed = text.replace(
        /\/Span\s*<<[^>]*?\/ActualText\s*<[0-9A-Fa-f]*>\s*>>\s*BDC/g,
        '/Span<< >>BDC',
      )
      if (fixed !== text) setStreamText(part, fixed)
    }
  }

  return doc.save({ useObjectStreams: false, addDefaultPage: false })
}
