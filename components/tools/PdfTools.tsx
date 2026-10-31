'use client'

// The PDF tools suite (hub + six tools). Everything runs client-side with
// pdf-lib / pdf.js / mammoth / JSZip — no file ever leaves the device, and
// the AI usage counter is untouched (these tools are not AI).

import { useCallback, useEffect, useRef, useState } from 'react'
import Icon, { type IconName } from '@/components/Icon'
import type { Dict } from '@/lib/dict'
import { Busy, Drop, ErrBox, Result, Rows, ToolFrame, fmt, type Entry } from './ui'
import {
  baseName, download, imagesToPdf, keepPages, looksPdf, mergePdfs, parseRanges,
  pdfPageCount, splitPdf, zipOf, type ImagePage,
} from '@/lib/tools/ops'
import { renderThumbs } from '@/lib/tools/pdfjs'
import { paginateFlow, pagesToPdf } from '@/lib/tools/htmlpdf'
import { docxToHtml, DOCX_STYLE } from '@/lib/tools/docx'
import { pptxToSlides } from '@/lib/tools/pptx'

type T = Dict['pdft']

const readBytes = (f: File) => f.arrayBuffer().then((b) => new Uint8Array(b))

const TOOLS: { id: ToolId; icon: IconName }[] = [
  { id: 'merge', icon: 'merge' },
  { id: 'split', icon: 'split' },
  { id: 'remove', icon: 'filex' },
  { id: 'images', icon: 'image' },
  { id: 'word', icon: 'doc' },
  { id: 'ppt', icon: 'slides' },
]
type ToolId = 'merge' | 'split' | 'remove' | 'images' | 'word' | 'ppt'

type Outcome = { name: string; size: number; title: string; redownload: () => void }

// ============================== merge ==============================

function MergeTool({ t, back }: { t: T; back: () => void }) {
  const [rows, setRows] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [out, setOut] = useState<Outcome | null>(null)

  const reset = () => { setOut(null); setRows([]); back() }

  const add = (files: File[]) =>
    setRows((r) => [...r, ...files.filter(looksPdf).map((file) => ({ id: `${file.name}-${file.size}-${Math.random()}`, file }))])
  const move = (id: string, dir: -1 | 1) =>
    setRows((r) => {
      const i = r.findIndex((e) => e.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= r.length) return r
      const c = [...r]
      ;[c[i], c[j]] = [c[j], c[i]]
      return c
    })

  const run = async () => {
    if (rows.length < 2) { setErr(t.merge.need); return }
    setErr(''); setBusy(true)
    try {
      const files = []
      for (const r of rows) files.push({ name: r.file.name, bytes: await readBytes(r.file) })
      const bytes = await mergePdfs(files)
      const name = `${baseName(files[0].name)}-merged.pdf`
      download(bytes, name)
      setOut({ name, size: bytes.length, title: t.merge.done, redownload: () => download(bytes, name) })
    } catch {
      setErr(t.errRead)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolFrame title={t.merge.name} onBack={reset} backLabel={t.back}>
      {out ? <Result title={out.title} name={out.name} size={out.size} onAgain={out.redownload}
        onReset={() => { setOut(null); setRows([]) }} labels={t} />
      : busy ? <Busy label={t.busy} />
      : <>
        <Drop multiple accept="application/pdf,.pdf" onFiles={add} label={t.pick} />
        {rows.length > 0 && <Rows entries={rows} onMove={move} onRemove={(id) => setRows((r) => r.filter((e) => e.id !== id))} t={t} />}
        {err && <ErrBox msg={err} />}
        <button type="button" className="btn btn-primary self-start" disabled={rows.length < 2} onClick={run}>
          <Icon name="merge" className="h-4 w-4" />{t.merge.go}
        </button>
      </>}
    </ToolFrame>
  )
}

// ============================== split ==============================

function SplitTool({ t, back }: { t: T; back: () => void }) {
  const [entry, setEntry] = useState<File | null>(null)
  const [pages, setPages] = useState(0)
  const [mode, setMode] = useState<'range' | 'each' | 'n'>('range')
  const [range, setRange] = useState('')
  const [n, setN] = useState('2')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [out, setOut] = useState<Outcome | null>(null)

  const pick = async (files: File[]) => {
    const f = files[0]
    if (!f || !looksPdf(f)) return
    setErr(''); setOut(null); setEntry(f)
    try {
      setPages(await pdfPageCount(await readBytes(f)))
    } catch {
      setEntry(null); setErr(t.errRead)
    }
  }

  const run = async () => {
    if (!entry) return
    setErr(''); setBusy(true)
    try {
      const bytes = await readBytes(entry)
      const base = baseName(entry.name)
      let items
      if (mode === 'range') {
        let list: number[]
        try { list = parseRanges(range, pages) } catch { setErr(t.split.need); setBusy(false); return }
        items = await splitPdf(bytes, base, { kind: 'range', pages: list })
      } else if (mode === 'each') {
        items = await splitPdf(bytes, base, { kind: 'each' })
      } else {
        items = await splitPdf(bytes, base, { kind: 'everyN', n: Math.max(1, parseInt(n, 10) || 1) })
      }
      if (items.length === 1) {
        const it = items[0]
        download(it.bytes, it.name)
        setOut({ name: it.name, size: it.bytes.length, title: t.split.single, redownload: () => download(it.bytes, it.name) })
      } else {
        const blob = await zipOf(items)
        const name = `${base}-split.zip`
        download(blob, name, 'application/zip')
        setOut({ name, size: blob.size, title: fmt(t.split.multi, { n: items.length }), redownload: () => download(blob, name, 'application/zip') })
      }
    } catch {
      setErr(t.errRead)
    } finally {
      setBusy(false)
    }
  }

  const leave = () => { setOut(null); setEntry(null); setPages(0); back() }

  return (
    <ToolFrame title={t.split.name} onBack={leave} backLabel={t.back}>
      {out ? <Result title={out.title} name={out.name} size={out.size} onAgain={out.redownload}
        onReset={() => { setOut(null); setEntry(null); setPages(0) }} labels={t} />
      : busy ? <Busy label={t.busy} />
      : <>
        {!entry ? <Drop accept="application/pdf,.pdf" onFiles={pick} label={t.pickOne} />
        : <div className="flex flex-col gap-4">
          <p dir="auto" className="rounded-2xl bg-surface2 px-4 py-3 text-sm font-semibold">
            {entry.name}
            {pages > 0 && <span className="muted"> · {fmt(t.pages, { n: pages })}</span>}
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-bold">{t.split.mode}</legend>
            {([['range', t.split.byRange], ['each', t.split.byEach], ['n', t.split.byN]] as const).map(([v, label]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
                <input type="radio" name="splitmode" checked={mode === v} onChange={() => setMode(v)} className="accent-[color:var(--brand)]" />
                {label}
              </label>
            ))}
          </fieldset>
          {mode === 'range' && (
            <input dir="ltr" className="field" placeholder={t.split.rangePh} value={range} onChange={(e) => setRange(e.target.value)} />
          )}
          {mode === 'n' && (
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              {t.split.n}
              <input dir="ltr" type="number" min={1} max={Math.max(1, pages)} className="field" value={n} onChange={(e) => setN(e.target.value)} />
            </label>
          )}
          {err && <ErrBox msg={err} />}
          <button type="button" className="btn btn-primary self-start" disabled={!entry} onClick={run}>
            <Icon name="split" className="h-4 w-4" />{t.split.go}
          </button>
        </div>}
      </>}
    </ToolFrame>
  )
}

// ============================== remove pages ==============================

function RemoveTool({ t, back }: { t: T; back: () => void }) {
  const [entry, setEntry] = useState<File | null>(null)
  const [thumbs, setThumbs] = useState<{ index: number; url: string }[]>([])
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [prog, setProg] = useState(0)
  const [err, setErr] = useState('')
  const [out, setOut] = useState<Outcome | null>(null)
  const cancel = useRef({ cancelled: false })

  useEffect(() => () => { cancel.current.cancelled = true }, [])

  const pick = async (files: File[]) => {
    const f = files[0]
    if (!f || !looksPdf(f)) return
    cancel.current.cancelled = true
    const my = { cancelled: false }
    cancel.current = my
    setErr(''); setOut(null); setEntry(f); setThumbs([]); setMarked(new Set()); setProg(0); setLoading(true)
    try {
      await renderThumbs(
        await readBytes(f), 140,
        (th) => !my.cancelled && setThumbs((p) => [...p, { index: th.index, url: th.url }]),
        (d, total) => !my.cancelled && setProg(d / total),
        my,
      )
    } catch {
      if (!my.cancelled) { setEntry(null); setErr(t.errRead) }
    } finally {
      if (!my.cancelled) setLoading(false)
    }
  }

  const toggle = (i: number) =>
    setMarked((m) => {
      const c = new Set(m)
      if (c.has(i)) c.delete(i)
      else c.add(i)
      return c
    })

  const run = async () => {
    if (!entry || !marked.size) { if (!marked.size) setErr(t.remove.none); return }
    setErr(''); setBusy(true)
    try {
      const keep = thumbs.map((x) => x.index).filter((i) => !marked.has(i)).sort((a, b) => a - b)
      if (!keep.length) { setErr(t.remove.none); setBusy(false); return }
      const bytes = await keepPages(await readBytes(entry), keep)
      const name = `${baseName(entry.name)}-clean.pdf`
      download(bytes, name)
      setOut({ name, size: bytes.length, title: t.remove.done, redownload: () => download(bytes, name) })
    } catch {
      setErr(t.errRead)
    } finally {
      setBusy(false)
    }
  }

  const leave = () => { cancel.current.cancelled = true; setOut(null); setEntry(null); setThumbs([]); setMarked(new Set()); back() }

  return (
    <ToolFrame title={t.remove.name} onBack={leave} backLabel={t.back}>
      {out ? <Result title={out.title} name={out.name} size={out.size} onAgain={out.redownload}
        onReset={() => { setOut(null); setEntry(null); setThumbs([]); setMarked(new Set()) }} labels={t} />
      : !entry ? <Drop accept="application/pdf,.pdf" onFiles={pick} label={t.pickOne} />
      : busy ? <Busy label={t.busy} />
      : <div className="flex flex-col gap-4">
        {loading ? <Busy label={t.remove.loading} pct={prog} />
        : <>
          <div className="flex flex-wrap items-center gap-2">
            {marked.size > 0 && <span className="chip">{fmt(t.remove.sel, { n: marked.size })}</span>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() =>
              setMarked((m) => (m.size ? new Set() : new Set(thumbs.map((x) => x.index))))}>
              {t.remove.invert}
            </button>
            <span className="muted text-xs">{fmt(t.pages, { n: thumbs.length })}</span>
          </div>
          <div className="grid max-h-[420px] gap-3 overflow-y-auto p-1" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))' }}>
            {thumbs.map((x) => (
              <button key={x.index} type="button" onClick={() => toggle(x.index)}
                aria-pressed={marked.has(x.index)}
                className={`relative overflow-hidden rounded-xl border-2 transition ${marked.has(x.index) ? 'border-[color:var(--danger)] opacity-60' : 'border-line hover:border-brand'}`}>
                <img src={x.url} alt={`p${x.index}`} className="block w-full" />
                <span className="absolute bottom-1 end-1 rounded-md bg-black/60 px-1.5 text-[11px] font-bold text-white">{x.index}</span>
                {marked.has(x.index) && (
                  <span className="absolute inset-0 grid place-items-center text-3xl font-black text-[color:var(--danger)]">✕</span>
                )}
              </button>
            ))}
          </div>
          {err && <ErrBox msg={err} />}
          <button type="button" className="btn btn-primary self-start" disabled={!thumbs.length} onClick={run}>
            <Icon name="filex" className="h-4 w-4" />{t.remove.go}
          </button>
        </>}
      </div>}
    </ToolFrame>
  )
}

// ============================== images → pdf ==============================

function ImagesTool({ t, back }: { t: T; back: () => void }) {
  const [rows, setRows] = useState<Entry[]>([])
  const [page, setPage] = useState<ImagePage>('a4')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [out, setOut] = useState<Outcome | null>(null)

  const add = (files: File[]) =>
    setRows((r) => [...r, ...files.filter((f) => f.type.startsWith('image/')).map((file) => ({ id: `${file.name}-${file.size}-${Math.random()}`, file }))])
  const move = (id: string, dir: -1 | 1) =>
    setRows((r) => {
      const i = r.findIndex((e) => e.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= r.length) return r
      const c = [...r]
      ;[c[i], c[j]] = [c[j], c[i]]
      return c
    })

  const run = async () => {
    if (!rows.length) { setErr(t.images.need); return }
    setErr(''); setBusy(true)
    try {
      const imgs = []
      for (const r of rows) imgs.push({ name: r.file.name, bytes: await readBytes(r.file), type: r.file.type || 'image/jpeg' })
      const bytes = await imagesToPdf(imgs, page)
      const name = `${baseName(rows[0].file.name)}-images.pdf`
      download(bytes, name)
      setOut({ name, size: bytes.length, title: t.images.done, redownload: () => download(bytes, name) })
    } catch {
      setErr(t.err)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => { setOut(null); setRows([]); back() }

  return (
    <ToolFrame title={t.images.name} onBack={reset} backLabel={t.back}>
      {out ? <Result title={out.title} name={out.name} size={out.size} onAgain={out.redownload}
        onReset={() => { setOut(null); setRows([]) }} labels={t} />
      : busy ? <Busy label={t.busy} />
      : <>
        <Drop multiple accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp" onFiles={add} label={t.pick} />
        {rows.length > 0 && <Rows entries={rows} onMove={move} onRemove={(id) => setRows((r) => r.filter((e) => e.id !== id))} t={t} />}
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {t.images.size}
          <select className="field" value={page} onChange={(e) => setPage(e.target.value as ImagePage)}>
            <option value="a4">{t.images.a4}</option>
            <option value="auto">{t.images.auto}</option>
          </select>
        </label>
        {err && <ErrBox msg={err} />}
        <button type="button" className="btn btn-primary self-start" disabled={!rows.length} onClick={run}>
          <Icon name="image" className="h-4 w-4" />{t.images.go}
        </button>
      </>}
    </ToolFrame>
  )
}

// ============================== word / ppt ==============================

function ConvertTool({ t, kind, back }: { t: T; kind: 'word' | 'ppt'; back: () => void }) {
  const c = kind === 'word' ? t.word : t.ppt
  const [entry, setEntry] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [err, setErr] = useState('')
  const [out, setOut] = useState<Outcome | null>(null)

  const pick = (files: File[]) => {
    const f = files[0]
    if (!f) return
    const ok = kind === 'word' ? /\.docx$/i.test(f.name) : /\.pptx$/i.test(f.name)
    setErr(ok ? '' : c.hint)
    if (ok) { setEntry(f); setOut(null) }
  }

  const run = async () => {
    if (!entry) return
    setErr(''); setBusy(true); setProg(null)
    try {
      const bytes = await readBytes(entry)
      const name = `${baseName(entry.name)}.pdf`
      let out
      if (kind === 'word') {
        const html = await docxToHtml(bytes)
        const { pages: els, dispose } = await paginateFlow(html, { styleCss: DOCX_STYLE })
        try {
          out = await pagesToPdf(els.map((el) => ({ el, wPx: 794, hPx: 1123 })),
            (d, tot) => setProg({ done: d, total: tot }))
        } finally {
          dispose()
        }
      } else {
        const { slides, dispose } = await pptxToSlides(bytes)
        try {
          out = await pagesToPdf(slides, (d, tot) => setProg({ done: d, total: tot }))
        } finally {
          dispose()
        }
      }
      download(out.bytes, name)
      setOut({ name, size: out.bytes.length, title: c.done, redownload: () => download(out.bytes, name) })
    } catch (e) {
      // Dev diagnostics: the raw failure is visible in the page for support,
      // while the user only ever sees the friendly localized message.
      ;(window as unknown as Record<string, unknown>).__convErr = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      setErr(e instanceof Error && e.message === 'parse' ? t.errRead : t.err)
    } finally {
      setBusy(false); setProg(null)
    }
  }

  const reset = () => { setEntry(null); setOut(null); setErr('') }

  return (
    <ToolFrame title={c.name} onBack={() => { reset(); back() }} backLabel={t.back}>
      {out ? <Result title={out.title} name={out.name} size={out.size} onAgain={out.redownload} onReset={reset} labels={t} />
      : busy ? <Busy label={prog ? fmt(t.pageOf, { i: prog.done + 1, n: prog.total }) : t.busy} pct={prog ? prog.done / prog.total : undefined} />
      : <>
        <Drop accept={kind === 'word' ? '.docx' : '.pptx'} onFiles={pick} label={t.pickOne} />
        {entry && <p dir="auto" className="rounded-2xl bg-surface2 px-4 py-3 text-sm font-semibold">{entry.name}</p>}
        <p className="muted text-xs leading-6">{c.hint}</p>
        {err && <ErrBox msg={err} />}
        <button type="button" className="btn btn-primary self-start" disabled={!entry} onClick={run}>
          <Icon name={kind === 'word' ? 'doc' : 'slides'} className="h-4 w-4" />{c.go}
        </button>
      </>}
    </ToolFrame>
  )
}

// ============================== hub ==============================

export default function PdfTools({ t }: { t: T }) {
  const [active, setActive] = useState<ToolId | null>(null)
  const goBack = useCallback(() => {
    setActive(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  const go = useCallback((id: ToolId) => {
    setActive(id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  if (active === 'merge') return <MergeTool t={t} back={goBack} />
  if (active === 'split') return <SplitTool t={t} back={goBack} />
  if (active === 'remove') return <RemoveTool t={t} back={goBack} />
  if (active === 'images') return <ImagesTool t={t} back={goBack} />
  if (active === 'word') return <ConvertTool t={t} kind="word" back={goBack} />
  if (active === 'ppt') return <ConvertTool t={t} kind="ppt" back={goBack} />

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-extrabold">{t.title}</h1>
        <p className="muted text-sm leading-7">{t.sub}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map(({ id, icon }) => {
          const c = id === 'merge' ? t.merge : id === 'split' ? t.split : id === 'remove' ? t.remove
            : id === 'images' ? t.images : id === 'word' ? t.word : t.ppt
          return (
            <button key={id} type="button" onClick={() => go(id)}
              className="panel group flex items-start gap-3.5 p-5 text-start transition hover:-translate-y-0.5 hover:shadow-lg">
              <span className="tile bg-brand-soft text-brand">
                <Icon name={icon} className="h-[22px] w-[22px]" />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2 font-bold">
                  {c.name}
                  <Icon name="back" className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-60 rtl:rotate-180 ltr:rotate-180" />
                </span>
                <span className="muted text-sm leading-6">{c.desc}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
