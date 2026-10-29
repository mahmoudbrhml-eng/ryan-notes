// Styles used by Paged.js to build the PDF: running header/footer, cover page, contents with page numbers.
export const PRINT_CSS = `
@page { size: A4; margin: 22mm 16mm 22mm 16mm;
  @top-left { content: "Ryan Notes"; font-family: sans-serif; font-size: 8.5pt; color: #6b7280; }
  @top-right { content: string(doctitle); font-family: sans-serif; font-size: 8.5pt; color: #6b7280; }
  @bottom-center { content: counter(page); font-family: sans-serif; font-size: 9pt; color: #374151; }
  @bottom-left { content: string(subj); font-family: sans-serif; font-size: 8.5pt; color: #6b7280; }
}
@page cover { margin: 0;
  @top-left { content: none; } @top-right { content: none; }
  @bottom-center { content: none; } @bottom-left { content: none; }
}
.doc-cover { page: cover; width: 210mm; height: 296mm; display: flex; flex-direction: column; direction: ltr; text-align: left; background: #fff; }
.cover-band { flex: 0 0 60%; background: linear-gradient(135deg, #1b4278 0%, #0f5c78 62%, #0b6f69 100%); color: #fff; padding: 36mm 22mm 20mm; display: flex; flex-direction: column; justify-content: flex-end; gap: 6mm; }
.cover-brand { font-size: 11pt; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; opacity: 0.9; }
.cover-kind { font-size: 13pt; font-weight: 600; color: #bfe9e4; }
.doc-title { string-set: doctitle content(text); font-size: 30pt; font-weight: 800; line-height: 1.3; unicode-bidi: plaintext; text-align: start; margin: 0; }
.doc-subject { string-set: subj content(text); }
.cover-meta { padding: 16mm 22mm 0; display: grid; grid-template-columns: 1fr 1fr; gap: 9mm; }
.cover-meta span { display: block; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #6b7280; margin-bottom: 1mm; }
.cover-meta b { font-size: 13pt; color: #111827; }
.cover-foot { margin-top: auto; padding: 0 22mm 14mm; font-size: 9pt; color: #6b7280; }

.doc-toc { break-before: page; break-after: page; direction: ltr; text-align: left; }
.toc-title { font-size: 24pt; font-weight: 800; color: #1b4278; margin: 0 0 9mm; padding-bottom: 4mm; border-bottom: 3px solid #0b6f69; }
.doc-toc ol { list-style: none; margin: 0; padding: 0; }
.doc-toc li { display: flex; align-items: baseline; gap: 6px; font-size: 11.5pt; line-height: 2.1; }
.doc-toc li.l2 { font-weight: 700; margin-top: 3pt; }
.doc-toc li.l3 { padding-inline-start: 12mm; font-size: 10.5pt; color: #374151; }
.doc-toc a { color: inherit; text-decoration: none; }
.doc-toc .num { color: #0b6f69; margin-inline-end: 4px; }
.doc-toc .dots { flex: 1; border-bottom: 1.5px dotted #9ca3af; transform: translateY(-3px); min-width: 12px; }
.doc-toc .pg { min-width: 9mm; text-align: right; font-variant-numeric: tabular-nums; }
.doc-toc .pg::after { content: target-counter(attr(href url), page); }

.doc-body { break-before: page; counter-reset: sec sub; }
.doc-body h2 { counter-increment: sec; counter-reset: sub; break-after: avoid; }
.doc-body h2::before { content: counter(sec) ". "; color: #0b6f69; }
.doc-body h3 { counter-increment: sub; break-after: avoid; }
.doc-body h3::before { content: counter(sec) "." counter(sub) " "; color: #1b4278; }
.doc-body table, .doc-body blockquote, .doc-body tr { break-inside: avoid; }
`
