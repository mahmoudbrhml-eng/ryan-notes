// End-to-end local test of the server text-PDF pipeline (same code paths as
// /api/pdf-build): markdown → HTML → Paged.js in headless Chromium → page.pdf.
// Verifies the output is REAL text (pypdf extract) and counts pages.
import { writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { PRINT_CSS } from '../lib/printCss'
import { buildDocHtml, buildTocItems, markdownToHtml, FALLBACK_CSS } from '../lib/pdfdoc'

declare global {
  interface Window {
    __Previewer?: unknown
    __paginate?: (css: string) => Promise<{ pages: number; srcLen: number; outLen: number }>
    __toFlow?: (css: string) => Promise<{ pages: number; srcLen: number; outLen: number }>
  }
}

const SAMPLE = `# Sample

## أمراض البروستاتا Prostate Diseases

البروستاتا هي غدة صغيرة توجد تحت المثانة **Bladder** عند الرجال فقط، وتحيط بالإحليل Urethra.

يحدث تضخم البروستاتا الحميد BPH في معظم الرجال بعد سن الخمسين، ومن أعراضه:

- التبول المتكرر ليلاً Nocturia
- ضعف تدفق البول Weak stream
- الشعور بعدم الإفراغ الكامل Incomplete emptying

### سرطان البروستاتا Prostate Cancer

سرطان البروستاتا هو من أكثر أنواع السرطان شيوعًا عند الرجال، ويرتبط بمستوى PSA في الدم.

| الدرجة Grade | وصف Description | العلاج Treatment |
| --- | --- | --- |
| منخفضة Low | مراقبة نشطة Active surveillance | متابعة دورية |
| متوسطة Intermediate | إشعاع أو جراحة | Radiation / Surgery |
| عالية High | علاج هرموني ADT | Hormone therapy |

> ملاحظة مهمة: فحص المستقيم الرقمي DRE جزء أساسي من الفحص السريري.

الهرمونات الذكرية Androgens تحفز نمو الخلايا السرطانية، لذلك يُستخدم مثبطات 5-alpha reductase.
`

const run = async () => {
  const t0 = Date.now()
  const title = 'أمراض البروستاتا'
  const bodyHtml = markdownToHtml(SAMPLE, 'rtl')
  console.log('bdi count:', (bodyHtml.match(/<bdi/g) ?? []).length, '| h ids:', (bodyHtml.match(/id="h\d+"/g) ?? []).length)
  const html = buildDocHtml({
    title,
    bodyHtml,
    kindLabel: 'Lecture notes',
    toc: buildTocItems(SAMPLE),
    fontB64: readFileSync(path.join(import.meta.dirname, '../assets/fonts/Cairo-Variable.ttf')).toString('base64'),
    printCss: PRINT_CSS,
  })
  writeFileSync('/tmp/pdf-test-doc.html', html)
  console.log('html bytes:', html.length)

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
    let pdf: Uint8Array
    if (stat.pages > 0 && stat.outLen >= stat.srcLen * 0.92) {
      pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    } else {
      console.warn('PAGED INCOMPLETE → flow fallback')
      await page.evaluate((css: string) => window.__toFlow!(css), FALLBACK_CSS)
      pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    }
    writeFileSync('/tmp/pdf-test-out.pdf', pdf)
    console.log('pdf bytes:', pdf.byteLength, 'in', Date.now() - t0, 'ms')
  } finally {
    await browser.close().catch(() => {})
  }
}

run().catch((e) => { console.error('FAIL:', e); process.exit(1) })
