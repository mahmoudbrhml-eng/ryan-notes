// Styles used by Paged.js to build the PDF: premium cover, contents with page numbers,
// running header/footer and refined body typography. Palette matches the Ryan Notes brand
// (deep navy → electric blue → teal green).
export const PRINT_CSS = `
/* ---------- page furniture ---------- */
@page {
  size: A4;
  margin: 21mm 16mm 21mm 16mm;
  @top-left { content: "RYAN NOTES"; font-family: var(--font-inter), sans-serif; font-size: 7.5pt; font-weight: 700; letter-spacing: .22em; color: #7c8aa5; }
  @top-right { content: string(doctitle); font-family: var(--font-cairo), var(--font-inter), sans-serif; font-size: 8.5pt; color: #7c8aa5; }
  @bottom-left { content: "ryan-notes.app"; font-family: var(--font-inter), sans-serif; font-size: 7.5pt; letter-spacing: .12em; color: #7c8aa5; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: var(--font-inter), sans-serif; font-size: 8.5pt; font-weight: 600; color: #45536b; }
}
@page cover { margin: 0;
  @top-left { content: none; } @top-right { content: none; }
  @bottom-left { content: none; } @bottom-right { content: none; }
}
@page toc { @top-right { content: none; } }

/* ---------- screen preview (does not print) ---------- */
@media screen {
  .pagedjs_pages { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px 0 26px; }
  .pagedjs_page { background: #fff; box-shadow: 0 3px 18px rgba(4,12,28,.16), 0 0 0 1px rgba(4,12,28,.06); }
}

/* ---------- cover: a small brand mark at the top and the topic title alone ---------- */
.doc-cover { page: cover; width: 210mm; height: 296mm; background: #fff; display: flex; flex-direction: column; align-items: center; }
.cover-mark { margin-top: 18mm; font-size: 10pt; font-weight: 700; letter-spacing: .34em; text-transform: uppercase; color: #8b98ae; }
.cover-topic { flex: 1; width: 100%; display: flex; align-items: center; justify-content: center; padding: 0 15mm 22mm; }
.doc-title { string-set: doctitle content(text); font-size: 42pt; font-weight: 800; line-height: 1.42; color: #0a1628; text-align: center; unicode-bidi: plaintext; text-wrap: balance; margin: 0; max-width: 176mm; }

/* ---------- contents ---------- */
.doc-toc { break-before: page; break-after: page; page: toc; direction: ltr; text-align: left; }
.toc-title { font-size: 25pt; font-weight: 800; color: #0a1628; margin: 0 0 3mm; }
.toc-sub { font-size: 10pt; color: #7c8aa5; margin: 0 0 9mm; }
.toc-underline { height: 1.1mm; width: 42mm; background: linear-gradient(90deg, #14b8a6, #3b82f6); border-radius: 99px; margin: 0 0 10mm; }
.doc-toc ol { list-style: none; margin: 0; padding: 0; }
.doc-toc li { display: flex; align-items: baseline; gap: 6px; font-size: 11.5pt; line-height: 2.15; }
.doc-toc li.l2 { font-weight: 700; color: #101828; margin-top: 4pt; }
.doc-toc li.l3 { padding-inline-start: 12mm; font-size: 10.5pt; color: #45536b; }
.doc-toc a { color: inherit; text-decoration: none; }
.doc-toc .num { color: #0b6f5c; font-weight: 700; margin-inline-end: 4px; font-variant-numeric: tabular-nums; }
.doc-toc .dots { flex: 1; border-bottom: 1.4px dotted #b9c4d6; transform: translateY(-3px); min-width: 12px; }
.doc-toc .pg { min-width: 10mm; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; color: #123a6b; }
.doc-toc .pg::after { content: target-counter(attr(href url), page); }

/* ---------- body ---------- */
.doc-body { break-before: page; counter-reset: sec sub; font-size: 10.5pt; line-height: 1.95; color: #1a2436; }
.doc-body p { margin: 0 0 3.2mm; orphans: 3; widows: 3; }
.doc-body h2 { counter-increment: sec; counter-reset: sub; break-after: avoid; break-inside: avoid;
  font-size: 16pt; font-weight: 800; color: #0a1628; margin: 9mm 0 4mm; padding-bottom: 2.2mm;
  border-bottom: .6mm solid #e3eaf3; }
.doc-body h2::before { content: counter(sec) ".  "; color: #0b6f5c; }
.doc-body h3 { counter-increment: sub; break-after: avoid; break-inside: avoid;
  font-size: 12.5pt; font-weight: 700; color: #123a6b; margin: 6.5mm 0 2.6mm; }
.doc-body h3::before { content: counter(sec) "." counter(sub) "  "; color: #3b82f6; font-variant-numeric: tabular-nums; }
.doc-body h4 { break-after: avoid; font-size: 11pt; font-weight: 700; color: #1a2436; margin: 5mm 0 2mm; }
.doc-body ul, .doc-body ol { margin: 2.4mm 0 3.6mm; padding-inline-start: 7mm; }
.doc-body li { margin: 1.1mm 0; }
.doc-body li::marker { color: #0b6f5c; font-weight: 700; }
.doc-body strong { color: #0a1628; }
.doc-body a { color: #0b6f5c; text-decoration: none; }
/* Tables and other blocks must be allowed to split across pages: an unbreakable
   block taller than one page used to stall the pagination engine and truncate
   the whole document. Rows stay unbreakable, and split tables repeat their header. */
.doc-body .overflow-x-auto { overflow: visible !important; }
.doc-body thead { display: table-header-group; }
.doc-body table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 4mm 0; line-height: 1.6; }
.doc-body th { background: #0a1628; color: #fff; font-weight: 700; padding: 2.2mm 3mm; text-align: start; }
.doc-body td { border: .35mm solid #d7e0ec; padding: 2mm 3mm; vertical-align: top; }
.doc-body tr { break-inside: avoid; }
.doc-body tr:nth-child(even) td { background: #f4f7fb; }
.doc-body blockquote { margin: 4mm 0; padding: 3mm 5mm; background: #eff9f7;
  border-inline-start: 1.2mm solid #14b8a6; border-radius: 2mm; color: #24354d; }
.doc-body code { font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace; font-size: 8.5pt;
  background: #f1f5f9; padding: .4mm 1.4mm; border-radius: 1.4mm; color: #0f2a43; }
.doc-body pre { background: #0f172a; color: #e2e8f0; padding: 4mm 4.5mm; border-radius: 2.4mm;
  font-size: 8.5pt; line-height: 1.7; white-space: pre-wrap; margin: 3.5mm 0; }
.doc-body pre code { background: none; color: inherit; padding: 0; }
.doc-body hr { border: none; height: .4mm; background: #e3eaf3; margin: 7mm 0; }
`
