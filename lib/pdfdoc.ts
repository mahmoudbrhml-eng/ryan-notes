// Shared builder for the server-side text PDF (/api/pdf-build): it mirrors the
// structure of the client print page (cover → contents → body) so the PDF looks
// the same, but Chromium renders real selectable text with proper Arabic shaping
// — instead of rasterized JPEG pages.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import { tocOf } from '@/components/Markdown'

// ---------- markdown → HTML (mirrors components/Markdown.tsx exactly) ----------
// Same bidi wrapping (English runs inside Arabic text get <bdi dir="ltr">), the
// same positional heading ids (h1, h2, …) and the same table wrapper.
type HNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HNode[] }
const AR = /[\u0600-\u06FF]/
const LATIN = /\(?[A-Za-z0-9][A-Za-z0-9'’\-–/&%+°µ×.]*(?: [A-Za-z0-9(][A-Za-z0-9'’\-–/&%+°µ×.)]*)*\)?/g

function bidiWalk(node: HNode) {
  if (!node.children) return
  if (node.type === 'element' && (node.tagName === 'code' || node.tagName === 'pre')) return
  const next: HNode[] = []
  for (const c of node.children) {
    if (c.type === 'text' && c.value && AR.test(c.value)) {
      const v = c.value
      let last = 0
      for (const m of v.matchAll(LATIN)) {
        const s = m.index ?? 0
        if (s > last) next.push({ type: 'text', value: v.slice(last, s) })
        next.push({ type: 'element', tagName: 'bdi', properties: { dir: 'ltr' }, children: [{ type: 'text', value: m[0] }] })
        last = s + m[0].length
      }
      if (last < v.length) next.push({ type: 'text', value: v.slice(last) })
    } else {
      bidiWalk(c)
      next.push(c)
    }
  }
  node.children = next
}

function structureWalk(node: HNode, n: { v: number }) {
  const kids = node.children
  if (!kids) return
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i]
    if (c.type === 'element') {
      if (c.tagName === 'h2' || c.tagName === 'h3') c.properties = { ...c.properties, id: `h${++n.v}` }
      if (c.tagName === 'table') {
        kids[i] = { type: 'element', tagName: 'div', properties: { className: ['overflow-x-auto'] }, children: [c] }
      }
    }
    structureWalk(c, n)
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(() => (tree) => {
    const root = tree as unknown as HNode
    bidiWalk(root)
    structureWalk(root, { v: 0 })
  })
  .use(rehypeStringify)
  .freeze()
// Like <Markdown dir> on the client: the wrapper carries the reading direction.
export const markdownToHtml = (md: string, dir: 'rtl' | 'ltr') =>
  `<div class="md" dir="${dir}">${String(processor.processSync(md))}</div>`

export const cleanTopic = (s: string) =>
  s
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*(?:\d{1,2}\s*[.)-]|[٠-٩]{1,2}\s*[-.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)

export function topicFrom(md: string): string {
  const heads = tocOf(md)
  for (const lv of [2, 3]) {
    const h = heads.find((x) => x.level === lv)
    if (h) {
      const c = cleanTopic(h.text)
      if (c.length >= 3) return c
    }
  }
  return ''
}

// The contents page is always in English: keep only the English part of each heading.
export function englishOnly(s: string) {
  const runs = s.match(/[A-Za-z][A-Za-z0-9 ,'’\-–/&%+.:]*[A-Za-z0-9]/g)
  return runs ? runs.map((r) => r.trim()).join(' — ') : s
}

export type TocItem = { id: string; num: string; label: string; level: number }
export function buildTocItems(md: string): TocItem[] {
  let n2 = 0
  let n3 = 0
  return tocOf(md).map((h) => {
    if (h.level === 2) {
      n3 = 0
      return { id: h.id, num: `${++n2}.`, label: englishOnly(h.text), level: h.level }
    }
    return { id: h.id, num: `${n2}.${++n3}`, label: englishOnly(h.text), level: h.level }
  })
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const LATIN_WORD = /^[A-Za-z0-9][A-Za-z0-9'’\-–&%+.:()]*$/
// The cover title styled word by word (teal → blue → navy), like the client page.
export function coloredTitleHtml(title: string): string {
  const words = title.split(/\s+/).filter(Boolean)
  return words
    .map((w, i) => {
      const inner = LATIN_WORD.test(w) ? `<bdi dir="ltr">${esc(w)}</bdi>` : esc(w)
      return `<span class="tw${i % 3}">${inner}</span>${i < words.length - 1 ? ' ' : ''}`
    })
    .join('')
}

// Native-Chromium fallback (used only if the Paged.js engine fails server-side):
// flowing layout printed straight to PDF — still real text, no page furniture.
export const FALLBACK_CSS = `
@page { size: A4; margin: 16mm 14mm; }
.doc-cover { height: 240mm; }
.cover-mark { margin-top: 40mm; }
.doc-cover, .doc-toc { page-break-after: always; }
.doc-body { break-before: auto; }
.doc-toc .pg { display: none; }
`

// Body typography for the standalone shell. The client print page inherits the
// .md/.doc rules from globals.css; the server shell is self-contained, so the
// same rules are inlined here (kept intentionally in sync with globals.css).
const SHELL_CSS = `
.md { line-height: 1.95; font-size: 11.5pt; }
.md :is(p, li, h1, h2, h3, h4, blockquote, td, th) { unicode-bidi: plaintext; text-align: start; }
.md[dir="rtl"] :is(p, li, h1, h2, h3, h4, blockquote, td, th) { unicode-bidi: normal; direction: rtl; text-align: right; }
.md[dir="ltr"] :is(p, li, h1, h2, h3, h4, blockquote, td, th) { unicode-bidi: normal; direction: ltr; text-align: left; }
.md bdi { unicode-bidi: isolate; }
.md h2 { font-size: 16pt; font-weight: 700; margin: 22pt 0 6pt; color: #0b6f69; border-bottom: 2px solid #0b6f69; padding-bottom: 4px; }
.md h3 { font-size: 13pt; font-weight: 700; margin: 14pt 0 5pt; color: #1b4278; }
.md p { margin: .6rem 0; text-wrap: pretty; }
.md ul, .md ol { margin: .6rem 0; padding-inline-start: 1.5rem; }
.md ul { list-style: disc; } .md ol { list-style: decimal; }
.md li { margin: 3px 0; }
.md blockquote { margin: 1rem 0; padding: 10px 14px; border-radius: 10px; background: #fff4d6; border: 1px solid #d9c48a; }
.md table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 10.5pt; }
.md th, .md td { border: 1px solid #cfd6e2; padding: 7px 10px; }
.md th { background: #0b6f69; color: #fff; text-align: start; }
.md tr:nth-child(even) td { background: #f3f7f9; }
.md strong { font-weight: 700; color: #0a1628; }
.md code { background: #f1f5f9; padding: 1px 5px; border-radius: 5px; font-size: .9em; font-family: ui-monospace, Menlo, monospace; }
.md pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 10px; font-size: 9pt; line-height: 1.6; white-space: pre-wrap; }
.md pre code { background: none; color: inherit; padding: 0; }
.md a { color: #0b6f5c; text-decoration: none; }
.md p, .md li { orphans: 3; widows: 3; }
.doc-body { break-before: page; font-size: 10.5pt; line-height: 1.95; color: #1a2436; }
.doc, .doc-body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc { background: #fff; color: #111827; }
`

export function buildDocHtml({
  title,
  bodyHtml,
  kindLabel,
  toc,
  fontB64,
  printCss,
}: {
  title: string
  bodyHtml: string
  kindLabel: string
  toc: TocItem[]
  fontB64: string
  printCss: string
}): string {
  const tocHtml =
    toc.length === 0
      ? ''
      : `<section class="doc-toc">
  <h2 class="toc-title">Contents</h2>
  <p class="toc-sub">${toc.length} sections · ${esc(kindLabel)}</p>
  <div class="toc-underline"></div>
  <ol>
    ${toc.map((h) => `<li class="l${h.level}"><a class="t" href="#${esc(h.id)}"><span class="num">${esc(h.num)}</span>${esc(h.label)}</a><span class="dots"></span><a class="pg" href="#${esc(h.id)}"></a></li>`).join('\n    ')}
  </ol>
</section>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
@font-face {
  font-family: 'CairoPDF';
  src: url(data:font/ttf;base64,${fontB64}) format('truetype');
  font-weight: 200 1000;
  font-style: normal;
  font-display: block;
}
:root { --font-inter: 'CairoPDF'; --font-cairo: 'CairoPDF'; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'CairoPDF', sans-serif; color: #111827; }
#pdf-src { display: none; }
${SHELL_CSS}
${printCss}
</style>
</head>
<body>
<div class="doc" dir="ltr">
  <div id="pdf-src">
    <section class="doc-cover">
      <div class="cover-mark">Ryan Notes</div>
      <div class="cover-topic">
        <h1 class="doc-title">${coloredTitleHtml(title)}</h1>
        <div class="cover-rule"></div>
      </div>
    </section>
    ${tocHtml}
    <article class="doc-body">${bodyHtml}</article>
  </div>
  <div id="pdf-out"></div>
</div>
<script>
const squish = (s) => (s || '').replace(/\\s+/g, '').length
window.__stat = () => {
  const src = document.getElementById('pdf-src')
  const out = document.getElementById('pdf-out')
  return { srcLen: squish(src && src.textContent), outLen: squish(out && out.textContent), pages: document.querySelectorAll('.pagedjs_page').length }
}
window.__paginate = async (css) => {
  await (document.fonts ? document.fonts.ready : Promise.resolve())
  const src = document.getElementById('pdf-src')
  const frag = document.createDocumentFragment()
  Array.from(src.childNodes).forEach((n) => frag.appendChild(n.cloneNode(true)))
  await new window.__Previewer().preview(frag, [{ 'doc.css': css }], document.getElementById('pdf-out'))
  return window.__stat()
}
window.__toFlow = (css) => {
  const out = document.getElementById('pdf-out')
  if (out) out.innerHTML = ''
  const src = document.getElementById('pdf-src')
  if (src) src.style.display = 'block'
  const st = document.createElement('style')
  st.textContent = css
  document.head.appendChild(st)
  return window.__stat()
}
</script>
</body>
</html>`
}

export const safePdfName = (n: string) =>
  (n || 'ryan-notes').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'ryan-notes'
