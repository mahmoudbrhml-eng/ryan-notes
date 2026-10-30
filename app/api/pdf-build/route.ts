import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PRINT_CSS } from '@/lib/printCss'
import {
  buildDocHtml, buildTocItems, cleanTopic, topicFrom, safePdfName, markdownToHtml, FALLBACK_CSS,
} from '@/lib/pdfdoc'
import { fixArabicTextLayer } from '@/lib/pdffix'
import { createClient } from '@/lib/supabase/server'
import type { Browser } from 'puppeteer-core'

// Server-side TEXT PDF: headless Chromium renders the same document as the
// client preview (Paged.js engine) and prints it with page.pdf() — the output
// is a real, selectable, OCR-ready PDF with perfect Arabic shaping. The client
// falls back to its image pipeline only if this whole route fails.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

declare global {
  interface Window {
    __Previewer?: unknown
    __paginate?: (css: string) => Promise<{ pages: number; srcLen: number; outLen: number }>
    __toFlow?: (css: string) => Promise<{ pages: number; srcLen: number; outLen: number }>
  }
}

let fontB64: string | null = null
let pagedSrc: string | null = null
const lazyFont = () =>
  (fontB64 ??= readFileSync(path.join(process.cwd(), 'assets/fonts/Cairo-Variable.ttf')).toString('base64'))
const lazyPaged = () =>
  (pagedSrc ??= readFileSync(path.join(process.cwd(), 'lib/vendor/paged.esm.js'), 'utf8'))

type Stat = { pages: number; srcLen: number; outLen: number }

async function report(
  uid: string, doc: string, mode: string, pages: number, srcLen: number, outLen: number,
  ms: number, ok: boolean, err: string | null, ua: string,
) {
  try {
    const supabase = await createClient()
    await supabase.from('pdf_renders').insert({
      user_id: uid, doc: doc.slice(0, 20), mode: mode.slice(0, 20), pages: pages || null,
      src_len: srcLen || null, out_len: outLen || null, ms, ok, err, ua: ua.slice(0, 180),
    })
  } catch { /* telemetry only */ }
}

export async function POST(req: Request) {
  let browser: Browser | null = null
  const t0 = Date.now()
  let mode: 'server' | 'server-flow' = 'server'
  let pages = 0
  let srcLen = 0
  let outLen = 0
  let ok = false
  let errMsg: string | null = null
  let uid: string | null = null
  let doc = 'unknown'
  let title = 'Notes'
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    uid = claims?.claims?.sub ?? null
    if (!uid) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const kind = b.kind === 'summary' ? 'summary' : b.kind === 'merged' ? 'merged' : 'transcript'
    doc = kind

    let content = ''
    let lang = 'ar'
    let fileName = ''
    if (kind === 'merged' && typeof b.mergedId === 'string') {
      const { data } = await supabase
        .from('outputs').select('title, content, lang').eq('id', b.mergedId).eq('kind', 'merged').maybeSingle()
      content = data?.content ?? ''
      lang = data?.lang ?? 'ar'
      fileName = String(data?.title ?? '')
    } else if (typeof b.fileId === 'string') {
      const [{ data: file }, { data }] = await Promise.all([
        supabase.from('files').select('name').eq('id', b.fileId).maybeSingle(),
        supabase.from('outputs').select('content, lang').eq('file_id', b.fileId).eq('kind', kind).maybeSingle(),
      ])
      content = data?.content ?? ''
      lang = data?.lang ?? 'ar'
      fileName = file?.name ?? ''
    } else return NextResponse.json({ error: 'bad request' }, { status: 400 })
    if (!content) return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (content.length > 600000) return NextResponse.json({ error: 'too large' }, { status: 413 })

    title = topicFrom(content) || cleanTopic(fileName.replace(/\.[^.]+$/, '')) || 'Notes'
    const rtl = lang !== 'en'
    const kindLabel = kind === 'merged' ? 'Combined notes' : kind === 'summary' ? 'Summary' : 'Lecture notes'
    const bodyHtml = markdownToHtml(content, rtl ? 'rtl' : 'ltr')
    const html = buildDocHtml({
      title, bodyHtml, kindLabel, toc: buildTocItems(content), fontB64: lazyFont(), printCss: PRINT_CSS,
    })

    const chromium = (await import('@sparticuz/chromium')).default
    const puppeteer = await import('puppeteer-core')
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: 1240, height: 1754 },
    })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 })
    // The vendored Paged.js build is ESM; inject it as an inline module and wait
    // for it to expose the Previewer before paginating.
    await page.addScriptTag({ content: `${lazyPaged()}\nwindow.__Previewer = Previewer;`, type: 'module' })
    await page.waitForFunction('window.__Previewer !== undefined', { timeout: 15000, polling: 100 })

    let stat: Stat
    try {
      stat = await Promise.race([
        page.evaluate((css: string) => window.__paginate!(css), PRINT_CSS),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('pagination timed out')), 40000)),
      ])
      const complete = stat.pages > 0 && (stat.srcLen <= 1500 || stat.outLen >= stat.srcLen * 0.92)
      if (!complete) throw new Error(`incomplete render: ${stat.pages} pages, ${stat.outLen}/${stat.srcLen} chars`)
    } catch (e) {
      // Native Chromium print fallback: flowing layout straight to PDF — still
      // real text, just without the page furniture (headers/TOC page numbers).
      mode = 'server-flow'
      errMsg = e instanceof Error ? e.message.slice(0, 160) : 'pagination failed'
      stat = await page.evaluate((css: string) => window.__toFlow!(css), FALLBACK_CSS)
    }
    pages = stat.pages || (await page.evaluate(() => document.querySelectorAll('#pdf-src > *').length))
    srcLen = stat.srcLen
    outLen = stat.outLen

    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
    if (pdf.byteLength < 2048) throw new Error('pdf suspiciously small')
    ok = true
    errMsg = null

    // Chromium writes Arabic ligature glyphs with broken ToUnicode entries
    // (presentation forms, missing lam-alef) — copy/search/OCR then read wrong
    // words. Rewrite the text layer to logical letters; rendering is untouched.
    const cleaned = await fixArabicTextLayer(new Uint8Array(pdf))

    const ascii = safePdfName(title).replace(/[^\x20-\x7E]/g, '') || 'ryan-notes'
    void report(uid, doc, mode, pages, srcLen, outLen, Date.now() - t0, true, null, req.headers.get('user-agent') ?? '')

    return new NextResponse(cleaned as unknown as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(safePdfName(title))}.pdf`,
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    errMsg = e instanceof Error ? e.message.slice(0, 160) : 'unknown'
    if (uid) void report(uid, doc, mode, pages, srcLen, outLen, Date.now() - t0, false, errMsg, req.headers.get('user-agent') ?? '')
    return NextResponse.json({ error: 'pdf build failed', detail: errMsg }, { status: 500 })
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}
