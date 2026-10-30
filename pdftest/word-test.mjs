// Minimal surgical test: single Arabic word, dump raw extraction + ToUnicode CMap.
import { writeFileSync } from 'node:fs'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

const WORD = process.argv[2] ?? 'سرطان البروستاتا صغيرة وفقًا الخلايا'
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Cairo; src: url(data:font/ttf;base64,${process.env.CAIRO_B64}); font-weight: 100 900; }
body { font-family: Cairo, sans-serif; font-size: 20px; direction: rtl; }
</style></head><body>${WORD}</body></html>`

const browser = await puppeteer.launch({
  args: chromium.args, executablePath: await chromium.executablePath(), headless: true,
})
try {
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  const pdf = await page.pdf({ format: 'A4' })
  writeFileSync('/tmp/word.pdf', pdf)
  console.log('written /tmp/word.pdf', pdf.byteLength)
} finally { await browser.close().catch(() => {}) }
