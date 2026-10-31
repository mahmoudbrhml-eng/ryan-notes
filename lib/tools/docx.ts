'use client'

// Word (.docx) → HTML via mammoth (browser build), styled to match the site's
// document look. The HTML is then paginated and rasterized by htmlpdf.ts.
// Everything runs in the browser — the file is never uploaded.

const STYLE = `
* { box-sizing: border-box; }
body, div { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 15px; line-height: 1.85; color: #111827; }
p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote { unicode-bidi: plaintext; text-align: start; margin: 0; }
p { margin: 0 0 10px; }
h1 { font-size: 22px; font-weight: 700; margin: 18px 0 10px; color: #0b6f69; }
h2 { font-size: 18px; font-weight: 700; margin: 16px 0 8px; color: #0b6f69; border-bottom: 2px solid #d8e8e6; padding-bottom: 3px; }
h3 { font-size: 16px; font-weight: 700; margin: 14px 0 6px; color: #1b4278; }
h4, h5, h6 { font-size: 15px; font-weight: 700; margin: 12px 0 6px; }
ul, ol { margin: 6px 0 12px; padding-inline-start: 26px; }
li { margin: 3px 0; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; font-size: 13.5px; page-break-inside: auto; }
th, td { border: 1px solid #cbd5e1; padding: 7px 10px; vertical-align: top; }
th { background: #e0f3f1; font-weight: 700; }
img { max-width: 100%; height: auto; margin: 8px 0; }
strong, b { font-weight: 700; }
em, i { font-style: italic; }
a { color: #0b6f69; text-decoration: underline; }
blockquote { margin: 10px 0; padding: 8px 14px; background: #fff4d6; border-radius: 8px; }
sup { font-size: .7em; }
`

export async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')
  // The browser build reads options.arrayBuffer (its types declare Node's Buffer).
  const input = { arrayBuffer: bytes.slice().buffer } as unknown as Parameters<typeof mammoth.convertToHtml>[0]
  const res = await mammoth.convertToHtml(
    input,
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
      ],
    },
  )
  if (res.value.trim().length < 8) throw new Error('empty')
  return res.value
}

export const DOCX_STYLE = STYLE
export const DOCX_ACCEPT = '.docx'
