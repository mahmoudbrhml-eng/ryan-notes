// Variant of e2e.ts: same pipeline, but page.pdf({ tagged: true }) —
// verifies whether tagged PDFs fix the Arabic ToUnicode/ActualText layer.
import { writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { PRINT_CSS } from '../lib/printCss'
import { buildDocHtml, buildTocItems, markdownToHtml } from '../lib/pdfdoc'

declare global {
  interface Window {
    __Previewer?: unknown
    __paginate?: (css: string) => Promise<{ pages: number; srcLen: number; outLen: number }>
  }
}

const SAMPLE = `## أمراض البروستاتا Prostate Diseases

البروستاتا هي غدة صغيرة توجد تحت المثانة **Bladder** عند الرجال فقط، وتحيط بالإحليل Urethra.

يحدث تضخم البروستاتا الحميد BPH في معظم الرجال بعد سن الخمسين، ومن أعراضه التبول المتكرر ليلاً Nocturia وضعف تدفق البول Weak stream.

### سرطان البروستاتا Prostate Cancer

سرطان البروستاتا هو من أكثر أنواع السرطان شيوعًا عند الرجال، ويرتبط بمستوى PSA في الدم. الهرمونات الذكرية Androgens تحفز نمو الخلايا السرطانية، لذلك يُستخدم مثبطات 5-alpha reductase. وفقًا لإرشادات EAU يُنصح بإجراء فحص PSA الدوري.
`

const tagged = process.argv.includes('--tagged')

const run = async () => {
  const html = buildDocHtml({
    title: 'أمراض البروستاتا',
    bodyHtml: markdownToHtml(SAMPLE, 'rtl'),
    kindLabel: 'Lecture notes',
    toc: buildTocItems(SAMPLE),
    fontB64: readFileSync(path.join(import.meta.dirname, '../assets/fonts/Cairo-Variable.ttf')).toString('base64'),
    printCss: PRINT_CSS,
  })
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
    defaultViewport: { width: 1240, height: 1754 },
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 })
    const pagedSrc = readFileSync(path.join(import.meta.dirname, '../lib/vendor/paged.esm.js'), 'utf8')
    await page.addScriptTag({ content: `${pagedSrc}\nwindow.__Previewer = Previewer;`, type: 'module' })
    await page.waitForFunction('window.__Previewer !== undefined', { timeout: 15000, polling: 100 })
    const stat = await page.evaluate((css: string) => window.__paginate!(css), PRINT_CSS)
    console.log('paged stat:', stat)
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged })
    const out = tagged ? '/tmp/pdf-tagged.pdf' : '/tmp/pdf-untagged.pdf'
    writeFileSync(out, pdf)
    console.log(out, 'bytes:', pdf.byteLength)
  } finally {
    await browser.close().catch(() => {})
  }
}

run().catch((e) => { console.error('FAIL:', e); process.exit(1) })
