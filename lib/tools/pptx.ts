'use client'

// PowerPoint (.pptx) → slide elements. Parses the OOXML package with JSZip
// (slides, layouts, master, theme, media) and rebuilds every slide as a
// fixed-size absolutely-positioned element that htmlpdf.ts rasterizes into
// one PDF page per slide at the deck's native aspect ratio.
//
// Supported: text boxes with sizes/colors/alignment/bullets, pictures, simple
// tables, solid/image backgrounds, grouped shapes (chOff/chExt remapping),
// placeholder geometry inherited from layout/master. Charts and SmartArt
// degrade to a labeled box.

import JSZip from 'jszip'

const EMU_PX = 9525 // 914400 EMU/inch ÷ 96 px/inch
const FONT = "'Calibri', 'Segoe UI', Arial, sans-serif"

export type SlideEl = { el: HTMLElement; wPx: number; hPx: number }

// Coordinate mapping: slidePos = rawPos * s + o (top-level: s=1, o=0).
type Map2 = { s: number; ox: number; oy: number }
const IDENTITY: Map2 = { s: 1, ox: 0, oy: 0 }
const X = (emu: string | null | undefined, m: Map2, axis: 'x' | 'y') => {
  const raw = emu ? parseInt(emu, 10) / EMU_PX : 0
  return (axis === 'x' ? raw * m.s + m.ox : raw * m.s + m.oy)
}
const S = (emu: string | null | undefined, s: number) => (emu ? (parseInt(emu, 10) / EMU_PX) * s : 0)

type Rels = Record<string, string> // rId → target path inside the zip
type PhBox = { x: number; y: number; w: number; h: number }
type PhMap = Map<string, PhBox>
type ThemeColors = Record<string, string>
// Default text properties per placeholder family, read from the master's
// p:txStyles (slides rarely repeat sizes that the master already defines).
type StyleDefaults = { sz?: number; algn?: string }
type TextStyles = { title: StyleDefaults; body: StyleDefaults; other: StyleDefaults }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const firstEl = (root: Element | Document, path: string): Element | null =>
  root.getElementsByTagName(path)[0] ?? null

const parseXml = (text: string): Document => new DOMParser().parseFromString(text, 'application/xml')

function colorOf(el: Element | null, theme: ThemeColors): string | null {
  if (!el) return null
  const srgb = firstEl(el, 'a:srgbClr')
  if (srgb) return `#${srgb.getAttribute('val')}`
  const scheme = firstEl(el, 'a:schemeClr')
  if (scheme) {
    const c = theme[scheme.getAttribute('val') ?? '']
    if (c) return c
  }
  return null
}

// ---------- theme ----------
function parseTheme(doc: Document): ThemeColors {
  const out: ThemeColors = {
    tx1: '#000000', bg1: '#ffffff', tx2: '#44546a', bg2: '#e7e6e6',
    accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000',
    accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1',
  }
  const scheme = firstEl(doc, 'a:clrScheme')
  if (!scheme) return out
  const map: Record<string, string> = { dk1: 'tx1', lt1: 'bg1', dk2: 'tx2', lt2: 'bg2' }
  for (const child of [...scheme.children]) {
    const name = child.tagName.replace(/^a:/, '')
    const key = map[name] ?? name
    const sys = child.getElementsByTagName('a:sysClr')[0]
    if (sys) {
      const last = sys.getAttribute('lastClr')
      if (last) out[key] = `#${last}`
      continue
    }
    const c = colorOf(child, {})
    if (c) out[key] = c
  }
  return out
}

// ---------- relationships ----------
async function parseRels(zip: JSZip, partPath: string): Promise<Rels> {
  const relPath = partPath.replace(/([^/]+)$/, '_rels/$1.rels')
  const file = zip.file(relPath)
  const out: Rels = {}
  if (!file) return out
  const doc = parseXml(await file.async('string'))
  const base = partPath.replace(/([^/]+)$/, '')
  for (const rel of [...doc.getElementsByTagName('Relationship')]) {
    if (rel.getAttribute('TargetMode') === 'External') continue
    const id = rel.getAttribute('Id') ?? ''
    let target = rel.getAttribute('Target') ?? ''
    if (target.startsWith('../')) {
      let dir = base
      while (target.startsWith('../')) {
        dir = dir.replace(/[^/]+\/$/, '')
        target = target.slice(3)
      }
      target = dir + target
    } else if (!target.startsWith('/')) {
      target = base + target
    } else {
      target = target.slice(1)
    }
    out[id] = target
  }
  return out
}

// ---------- placeholder geometry ----------
function collectPlaceholders(doc: Document): PhMap {
  const map: PhMap = new Map()
  for (const sp of [...doc.getElementsByTagName('p:sp')]) {
    const ph = firstEl(sp, 'p:ph')
    if (!ph) continue
    const xfrm = firstEl(sp, 'a:xfrm')
    if (!xfrm) continue
    const off = firstEl(xfrm, 'a:off')
    const ext = firstEl(xfrm, 'a:ext')
    if (!off || !ext) continue
    const box: PhBox = {
      x: px1(off.getAttribute('x')), y: px1(off.getAttribute('y')),
      w: px1(ext.getAttribute('cx')), h: px1(ext.getAttribute('cy')),
    }
    const type = ph.getAttribute('type')
    const idx = ph.getAttribute('idx')
    if (type) map.set(type, box)
    if (idx) map.set(`idx:${idx}`, box)
  }
  return map
}

const px1 = (emu: string | null | undefined) => (emu ? parseInt(emu, 10) / EMU_PX : 0)

function ownBox(sp: Element): PhBox | null {
  // p:sp shapes use a:xfrm (inside spPr) but p:graphicFrame — tables and
  // charts — carries its position in a p:xfrm child. Missing p:xfrm made
  // every table in a deck silently disappear.
  const xfrm = firstEl(sp, 'a:xfrm') ?? firstEl(sp, 'p:xfrm')
  if (!xfrm) return null
  const off = firstEl(xfrm, 'a:off')
  const ext = firstEl(xfrm, 'a:ext')
  if (!off || !ext) return null
  return {
    x: px1(off.getAttribute('x')), y: px1(off.getAttribute('y')),
    w: px1(ext.getAttribute('cx')), h: px1(ext.getAttribute('cy')),
  }
}

function resolveBox(sp: Element, layoutPh: PhMap, masterPh: PhMap): PhBox | null {
  return ownBox(sp) ?? (() => {
    const ph = firstEl(sp, 'p:ph')
    if (!ph) return null
    const type = ph.getAttribute('type')
    const idx = ph.getAttribute('idx')
    const key = idx ? `idx:${idx}` : null
    return (
      (key && layoutPh.get(key)) || (type && layoutPh.get(type)) ||
      (key && masterPh.get(key)) || (type && masterPh.get(type)) || null
    )
  })()
}

// ---------- text ----------
function runsHtml(p: Element, theme: ThemeColors, s: number, bulletPrefix: string, fallbackSz?: number): string {
  let html = ''
  let first = true
  for (const child of [...p.children]) {
    const tag = child.tagName
    if (tag === 'a:r') {
      const rPr = firstEl(child, 'a:rPr')
      const t = firstEl(child, 'a:t')?.textContent ?? ''
      if (!t) continue
      const sz = rPr?.getAttribute('sz')
      const fontSize = sz ? (parseInt(sz, 10) / 100) * (96 / 72) * s : fallbackSz ? fallbackSz * s : null
      let style = ''
      if (fontSize) style += `font-size:${fontSize.toFixed(1)}px;`
      if (rPr?.getAttribute('b') === '1') style += 'font-weight:700;'
      if (rPr?.getAttribute('i') === '1') style += 'font-style:italic;'
      if (rPr?.getAttribute('u') === 'sng') style += 'text-decoration:underline;'
      const color = colorOf(rPr ?? null, theme)
      if (color) style += `color:${color};`
      html += `<span style="${style}">${first ? bulletPrefix : ''}${esc(t)}</span>`
      first = false
    } else if (tag === 'a:br') {
      html += '<br>'
      first = true
    } else if (tag === 'a:fld') {
      const t = firstEl(child, 'a:t')?.textContent ?? ''
      if (t) html += `<span>${esc(t)}</span>`
    }
  }
  return html
}

function txBodyHtml(el: Element, theme: ThemeColors, s: number, styles: StyleDefaults): { html: string; anchor: string } {
  const txBody = firstEl(el, 'p:txBody') ?? firstEl(el, 'a:txBody')
  if (!txBody) return { html: '', anchor: 'flex-start' }
  const bodyPr = firstEl(txBody, 'a:bodyPr')
  const anchorAttr = bodyPr?.getAttribute('anchor')
  const anchor = anchorAttr === 'ctr' ? 'center' : anchorAttr === 'b' ? 'flex-end' : 'flex-start'
  const paras: string[] = []
  for (const p of [...txBody.getElementsByTagName('a:p')]) {
    const pPr = firstEl(p, 'a:pPr')
    const algn = pPr?.getAttribute('algn') ?? styles.algn
    const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'start'
    const ilvl = parseInt(pPr?.getAttribute('lvl') ?? '0', 10) || 0
    const buChar = pPr ? firstEl(pPr, 'a:buChar') : null
    const buAuto = pPr ? firstEl(pPr, 'a:buAutoNum') : null
    const bullet = buChar ? `${esc(buChar.getAttribute('char') ?? '•')} ` : buAuto ? '#) ' : ''
    const text = runsHtml(p, theme, s, bullet, styles.sz)
    paras.push(
      `<div style="text-align:${align};padding-inline-start:${(ilvl * 20 * s).toFixed(0)}px;min-height:1em;">${text || '&nbsp;'}</div>`,
    )
  }
  return { html: paras.join(''), anchor }
}

// ---------- context ----------
type Ctx = {
  zip: JSZip
  theme: ThemeColors
  styles: TextStyles
  layoutPh: PhMap
  masterPh: PhMap
  slideRels: Rels
  mediaCache: Map<string, string>
}

// Placeholder family of a shape: 'title' | 'body' | 'other' — used to pick
// the matching master text-style defaults.
function phFamily(sp: Element): keyof TextStyles {
  const ph = firstEl(sp, 'p:ph')
  if (!ph) return 'other'
  const t = ph.getAttribute('type') ?? ''
  return t.includes('Title') || t === 'title' || t === 'ctrTitle' ? 'title' : t === 'sldImg' || t === 'pic' ? 'other' : 'body'
}

function parseTextStyles(master: Document): TextStyles {
  const get = (name: string): StyleDefaults => {
    const st = master.getElementsByTagName(`p:${name}`)[0]
    if (!st) return {}
    const lvl1 = st.getElementsByTagName('a:lvl1pPr')[0]
    const defRPr = lvl1?.getElementsByTagName('a:defRPr')[0]
    const sz = defRPr?.getAttribute('sz')
    return { sz: sz ? (parseInt(sz, 10) / 100) * (96 / 72) : undefined, algn: lvl1?.getAttribute('algn') ?? undefined }
  }
  return { title: get('titleStyle'), body: get('bodyStyle'), other: get('otherStyle') }
}

async function mediaDataUrl(ctx: Ctx, rId: string | null): Promise<string | null> {
  if (!rId) return null
  const hit = ctx.mediaCache.get(rId)
  if (hit !== undefined) return hit
  const path = ctx.slideRels[rId]
  const file = path ? ctx.zip.file(path) : null
  if (!file) return null
  const ext = path!.split('.').pop()?.toLowerCase() ?? ''
  const mime =
    ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' :
    ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg'
  const url = `data:${mime};base64,${await file.async('base64')}`
  ctx.mediaCache.set(rId, url)
  return url
}

async function shapeHtml(ctx: Ctx, sp: Element, m: Map2): Promise<string | null> {
  const box = resolveBox(sp, ctx.layoutPh, ctx.masterPh)
  if (!box || box.w <= 0 || box.h <= 0) return null
  const x = box.x * m.s + m.ox
  const y = box.y * m.s + m.oy
  const w = box.w * m.s
  const h = box.h * m.s

  // picture?
  const blip = firstEl(sp, 'a:blip')
  if (blip) {
    const url = await mediaDataUrl(ctx, blip.getAttribute('r:embed'))
    if (url) {
      return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;">` +
        `<img src="${url}" style="width:100%;height:100%;object-fit:contain;display:block;" alt=""></div>`
    }
  }

  const spPr = firstEl(sp, 'p:spPr') ?? sp
  const fill = colorOf(firstEl(spPr, 'a:solidFill'), ctx.theme)
  const ln = firstEl(spPr, 'a:ln')
  const hasLine = !!ln && !ln.getElementsByTagName('a:noFill').length
  const lineColor = hasLine ? colorOf(ln, ctx.theme) : null
  const { html: text, anchor } = txBodyHtml(sp, ctx.theme, m.s, ctx.styles[phFamily(sp)])
  if (!text && !fill && !lineColor) return null
  return (
    `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:flex;flex-direction:column;justify-content:${anchor};` +
    `${fill ? `background:${fill};` : ''}${lineColor ? `border:1px solid ${lineColor};` : ''}overflow:hidden;">${text}</div>`
  )
}

async function graphicFrameHtml(ctx: Ctx, gf: Element, m: Map2): Promise<string | null> {
  const box = resolveBox(gf, ctx.layoutPh, ctx.masterPh)
  if (!box) return null
  const x = box.x * m.s + m.ox
  const y = box.y * m.s + m.oy
  const w = box.w * m.s
  const h = box.h * m.s
  const tbl = firstEl(gf, 'a:tbl')
  if (!tbl) {
    // chart / SmartArt / diagram → labeled placeholder box
    return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:#f1f5f9;` +
      `border:1px dashed #94a3b8;display:flex;align-items:center;justify-content:center;color:#64748b;` +
      `font-family:${FONT};font-size:${(13 * m.s).toFixed(0)}px;">⌗</div>`
  }
  const cols = [...tbl.getElementsByTagName('a:gridCol')].map((c) => S(c.getAttribute('w'), m.s))
  let html = `<table style="border-collapse:collapse;width:${w}px;table-layout:fixed;">`
  html += '<colgroup>' + cols.map((cw) => `<col style="width:${cw.toFixed(1)}px">`).join('') + '</colgroup>'
  for (const tr of [...tbl.getElementsByTagName('a:tr')]) {
    html += '<tr>'
    for (const tc of [...tr.children]) {
      if (tc.tagName !== 'a:tc') continue
      const span = parseInt(tc.getAttribute('gridSpan') ?? '1', 10) || 1
      const tcPr = firstEl(tc, 'a:tcPr')
      const fill = tcPr ? colorOf(firstEl(tcPr, 'a:solidFill'), ctx.theme) : null
      const txt = txBodyHtml(tc, ctx.theme, m.s, ctx.styles.body)
      html += `<td colspan="${span}" style="border:1px solid #b9c2cf;padding:${(4 * m.s).toFixed(1)}px ${(6 * m.s).toFixed(1)}px;` +
        `font-family:${FONT};font-size:${(12 * m.s).toFixed(1)}px;vertical-align:top;${fill ? `background:${fill};` : ''}">` +
        `${txt.html || '&nbsp;'}</td>`
    }
    html += '</tr>'
  }
  html += '</table>'
  return `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;">${html}</div>`
}

async function walkTree(ctx: Ctx, tree: Element, m: Map2): Promise<string> {
  let html = ''
  for (const node of [...tree.children]) {
    const tag = node.tagName
    if (tag === 'p:sp' || tag === 'p:pic') {
      const s = await shapeHtml(ctx, node, m)
      if (s) html += s
    } else if (tag === 'p:graphicFrame') {
      const s = await graphicFrameHtml(ctx, node, m)
      if (s) html += s
    } else if (tag === 'p:grpSp') {
      // Group: children live in the child coordinate space (chOff/chExt).
      // screen = off + (childRaw − chOff) · (ext/chExt)  →  s' = s·ratio, o' = raw·s + (off−chOff·ratio)·s
      const xfrm = firstEl(node, 'a:xfrm')
      if (!xfrm) continue
      const ext = firstEl(xfrm, 'a:ext')
      const chExt = firstEl(xfrm, 'a:chExt')
      const off = firstEl(xfrm, 'a:off')
      const chOff = firstEl(xfrm, 'a:chOff')
      if (!ext || !chExt || !off || !chOff) continue
      const ratio = (px1(ext.getAttribute('cx')) || 1) / (px1(chExt.getAttribute('cx')) || 1)
      const childM: Map2 = {
        s: m.s * ratio,
        ox: m.ox + (px1(off.getAttribute('x')) - px1(chOff.getAttribute('x')) * ratio) * m.s,
        oy: m.oy + (px1(off.getAttribute('y')) - px1(chOff.getAttribute('y')) * ratio) * m.s,
      }
      html += await walkTree(ctx, node, childM)
    }
  }
  return html
}

// ---------- public ----------
export async function pptxToSlides(
  bytes: Uint8Array,
): Promise<{ slides: SlideEl[]; dispose: () => void }> {
  // Slide elements must stay attached to the document until rasterized —
  // html-to-image needs real layout geometry (a detached node is 0×0).
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;z-index:-1;'
  document.body.appendChild(host)
  const cleanup = () => host.remove()
  try {
    const zip = await JSZip.loadAsync(bytes)
    const presFile = zip.file('ppt/presentation.xml')
    if (!presFile) throw new Error('parse')
    const pres = parseXml(await presFile.async('string'))
    const sldSz = firstEl(pres, 'p:sldSz')
    const wPx = sldSz ? px1(sldSz.getAttribute('cx')) : 1280
    const hPx = sldSz ? px1(sldSz.getAttribute('cy')) : 720
    if (wPx < 100 || hPx < 100) throw new Error('parse')

    const presRels = await parseRels(zip, 'ppt/presentation.xml')
    const theme = parseTheme(parseXml((await zip.file('ppt/theme/theme1.xml')?.async('string')) ?? '<a:theme/>'))
    const masterDoc = parseXml((await zip.file('ppt/slideMasters/slideMaster1.xml')?.async('string')) ?? '<p:sldMaster/>')
    const masterPh = collectPlaceholders(masterDoc)
    const styles = parseTextStyles(masterDoc)
    const mediaCache = new Map<string, string>()

    const slides: SlideEl[] = []
    for (const sldId of [...pres.getElementsByTagName('p:sldId')]) {
      const slidePath = presRels[sldId.getAttribute('r:id') ?? '']
      const slideFile = slidePath ? zip.file(slidePath) : null
      if (!slideFile) continue
      const slideDoc = parseXml(await slideFile.async('string'))
      const slideRels = await parseRels(zip, slidePath)

      const layoutPath = Object.values(slideRels).find((t) => t.includes('slideLayouts/'))
      const layoutDoc = parseXml((await zip.file(layoutPath ?? '')?.async('string')) ?? '<p:sldLayout/>')
      const layoutPh = collectPlaceholders(layoutDoc)

      const ctx: Ctx = { zip, theme, styles, layoutPh, masterPh, slideRels, mediaCache }
      const tree = firstEl(slideDoc, 'p:cSld')?.getElementsByTagName('p:spTree')[0]
      let body = ''
      if (tree) body = await walkTree(ctx, tree, IDENTITY)

    // background (slide-level, else white)
    let bgCss = '#ffffff'
    const bgPr = firstEl(slideDoc, 'p:bg') ? firstEl(firstEl(slideDoc, 'p:bg')!, 'p:bgPr') : null
    if (bgPr) {
      const c = colorOf(firstEl(bgPr, 'a:solidFill'), theme)
      if (c) bgCss = c
      const bgBlip = firstEl(bgPr, 'a:blip')
      if (bgBlip) {
        const url = await mediaDataUrl(ctx, bgBlip.getAttribute('r:embed'))
        if (url) bgCss = `#fff center/cover no-repeat url('${url}')`
      }
    }

    const el = document.createElement('div')
    el.style.cssText =
      `width:${wPx}px;height:${hPx}px;position:relative;overflow:hidden;background:${bgCss};` +
      `font-family:${FONT};color:${theme.tx1};`
    el.innerHTML = body
    host.appendChild(el)
    slides.push({ el, wPx, hPx })
  }
    if (!slides.length) throw new Error('parse')
    return { slides, dispose: cleanup }
  } catch (e) {
    cleanup()
    throw e
  }
}