// Local test of lib/pdffix.ts: run fixArabicTextLayer over an existing
// Chromium-generated PDF and verify the extracted text layer.
import { readFileSync, writeFileSync } from 'node:fs'
import { fixArabicTextLayer } from '../lib/pdffix'

const src = process.argv[2] ?? '/tmp/e2e-live.pdf'
const out = process.argv[3] ?? '/tmp/e2e-fixed-ts.pdf'

const run = async () => {
  const bytes = readFileSync(src)
  const t0 = Date.now()
  const fixed = await fixArabicTextLayer(new Uint8Array(bytes))
  console.log('fixArabicTextLayer took', Date.now() - t0, 'ms; bytes', bytes.length, '->', fixed.length)
  writeFileSync(out, fixed)
}
run().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
