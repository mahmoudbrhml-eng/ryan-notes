'use client'

// PDF reader + annotations — an ADDITIVE workspace: it opens any uploaded PDF
// in its own route (/read/<fileId>) and lets the student draw, highlight and
// stick notes on every page. Annotations live in coordinates normalized 0..1
// to the page box (zoom/device independent) and are persisted per user+file+
// page in pdf_notes (RLS) through /api/pdf-notes. The rest of the app is not
// touched: the reader only consumes a signed URL handed over by the server.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getPdfjs } from '@/lib/tools/pdfjs'
import type { Dict } from '@/lib/dict'

type PdfDocument = import('pdfjs-dist').PDFDocumentProxy

type Item =
  | { id: string; kind: 'pen'; color: string; w: number; pts: number[] }
  | { id: string; kind: 'hl'; color: string; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'note'; color: string; x: number; y: number; text: string }

type Tool = 'pointer' | 'pen' | 'hl' | 'note' | 'eraser'
type Pt = { x: number; y: number }

// Yellow important · green definition · blue explanation · pink clinical · orange exam
const COLORS: { k: keyof Dict['reader']['colors']; v: string }[] = [
  { k: 'important', v: '#facc15' },
  { k: 'definition', v: '#4ade80' },
  { k: 'explanation', v: '#60a5fa' },
  { k: 'clinical', v: '#f472b6' },
  { k: 'exam', v: '#fb923c' },
]

const uid = () => Math.random().toString(36).slice(2, 10)
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function setupCanvas(c: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  c.width = Math.max(1, Math.floor(w * dpr))
  c.height = Math.max(1, Math.floor(h * dpr))
  c.style.width = `${Math.floor(w)}px`
  c.style.height = `${Math.floor(h)}px`
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

function drawItem(ctx: CanvasRenderingContext2D, it: Item, W: number, H: number) {
  if (it.kind === 'hl') {
    ctx.globalAlpha = 0.35
    ctx.fillStyle = it.color
    ctx.fillRect(it.x * W, it.y * H, it.w * W, it.h * H)
    ctx.globalAlpha = 1
  } else if (it.kind === 'pen' && it.pts.length >= 2) {
    ctx.strokeStyle = it.color
    ctx.lineWidth = it.w * (W / 800)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(it.pts[0] * W, it.pts[1] * H)
    for (let k = 2; k < it.pts.length; k += 2) ctx.lineTo(it.pts[k] * W, it.pts[k + 1] * H)
    if (it.pts.length === 2) ctx.lineTo(it.pts[0] * W + 0.2, it.pts[1] * H)
    ctx.stroke()
  }
}

const Ico = {
  hand: <path d="M9 11V4a1.5 1.5 0 0 1 3 0v6m0-2a1.5 1.5 0 0 1 3 0v3m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a7 7 0 0 1-7-7V9a1.5 1.5 0 0 1 3 0v2" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
  pen: <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z M14.5 6.5l3 3" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
  hl: <path d="M5 19h14M6.5 15.5L14 8l3 3-6.5 6.5H7l-.5-2zM15.5 6.5l2-2 3 3-2 2" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
  note: <path d="M5 4h14v11l-5 5H5V4zM14 20v-5h5" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
  eraser: <path d="M7 20h10M4.5 15.5l8-8a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3l-6 6h-4l-4-4z" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
  undo: <path d="M8 5L3 10l5 5M3 10h11a6 6 0 0 1 6 6v2" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
}

const ToolBtn = ({ active, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={`btn btn-sm btn-icon ${active ? 'btn-primary' : 'btn-ghost'}`}
  >
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]">{children}</svg>
  </button>
)

function PageView({
  doc, n, baseW, zoom, items, tool, color, editing, notePh,
  onCommit, onErase, onAddNote, onEditNote, onNoteText, onCloseEditor, onVisible, refCb,
}: {
  doc: PdfDocument
  n: number
  baseW: number
  zoom: number
  items: Item[]
  tool: Tool
  color: string
  editing: { page: number; id: string } | null
  notePh: string
  onCommit: (page: number, items: Item[]) => void
  onErase: (page: number, at: Pt) => void
  onAddNote: (page: number, at: Pt) => void
  onEditNote: (page: number, id: string) => void
  onNoteText: (page: number, id: string, text: string) => void
  onCloseEditor: (page: number, id: string) => void
  onVisible: (page: number) => void
  refCb: (page: number, el: HTMLDivElement | null) => void
}) {
  const holder = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const annoRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const stroke = useRef<number[] | null>(null)
  const last = useRef<Pt | null>(null)
  const anchor = useRef<Pt | null>(null)
  const [visible, setVisible] = useState(false)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  // render only when the page comes near the viewport
  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => {
        if (e.isIntersecting) { setVisible(true); if (e.intersectionRatio > 0.5) onVisible(n) }
      }),
      { rootMargin: '700px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [n, onVisible])

  // pdf page render
  useEffect(() => {
    if (!visible || !doc) return
    let dead = false
    let task: { cancel: () => void } | null = null
    ;(async () => {
      const page = await doc.getPage(n)
      if (dead) return
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min((baseW * zoom) / base.width, 4)
      const vp = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(vp.width * dpr))
      canvas.height = Math.max(1, Math.floor(vp.height * dpr))
      canvas.style.width = `${Math.floor(vp.width)}px`
      canvas.style.height = `${Math.floor(vp.height)}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, vp.width, vp.height)
      const r = page.render({
        canvas, canvasContext: ctx, viewport: vp,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      })
      task = r
      await r.promise
      if (!dead) setDims({ w: vp.width, h: vp.height })
    })().catch(() => {})
    return () => { dead = true; try { task?.cancel() } catch {} }
  }, [visible, doc, n, baseW, zoom])

  // committed annotations layer
  useEffect(() => {
    const c = annoRef.current
    if (!c || !dims) return
    const ctx = setupCanvas(c, dims.w, dims.h)
    if (!ctx) return
    for (const it of items) drawItem(ctx, it, dims.w, dims.h)
  }, [items, dims])

  const liveCtx = () => {
    const c = liveRef.current
    if (!c || !dims) return null
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }

  const norm = (e: React.PointerEvent): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }

  const down = (e: React.PointerEvent) => {
    const p = norm(e)
    if (tool === 'pen') {
      e.currentTarget.setPointerCapture(e.pointerId)
      stroke.current = [p.x, p.y]
      last.current = p
    } else if (tool === 'hl') {
      e.currentTarget.setPointerCapture(e.pointerId)
      anchor.current = p
    } else if (tool === 'note') {
      onAddNote(n, p)
    } else if (tool === 'eraser') {
      onErase(n, p)
    }
  }

  const move = (e: React.PointerEvent) => {
    const p = norm(e)
    const ctx = liveCtx()
    if (!ctx || !dims) return
    if (stroke.current && last.current) {
      stroke.current.push(p.x, p.y)
      ctx.strokeStyle = color
      ctx.lineWidth = 2.5 * (dims.w / 800)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(last.current.x * dims.w, last.current.y * dims.h)
      ctx.lineTo(p.x * dims.w, p.y * dims.h)
      ctx.stroke()
      last.current = p
    } else if (anchor.current) {
      const a = anchor.current
      ctx.globalAlpha = 0.35
      ctx.fillStyle = color
      ctx.fillRect(Math.min(a.x, p.x) * dims.w, Math.min(a.y, p.y) * dims.h, Math.abs(p.x - a.x) * dims.w, Math.abs(p.y - a.y) * dims.h)
      ctx.globalAlpha = 1
    }
  }

  const up = (e: React.PointerEvent) => {
    const p = norm(e)
    if (stroke.current) {
      const pts = stroke.current
      stroke.current = null
      last.current = null
      if (pts.length >= 2) onCommit(n, [...items, { id: uid(), kind: 'pen', color, w: 2.5, pts }])
    } else if (anchor.current) {
      const a = anchor.current
      anchor.current = null
      const x = Math.min(a.x, p.x)
      const y = Math.min(a.y, p.y)
      const w = Math.abs(p.x - a.x)
      const h = Math.abs(p.y - a.y)
      if (w > 0.01 && h > 0.005) onCommit(n, [...items, { id: uid(), kind: 'hl', color, x, y, w, h }])
    }
    const ctx = liveCtx()
    if (ctx && dims) ctx.clearRect(0, 0, dims.w, dims.h)
  }

  const notes = items.filter((i): i is Extract<Item, { kind: 'note' }> => i.kind === 'note')

  return (
    <div ref={(el) => { holder.current = el; refCb(n, el) }} className="relative mx-auto bg-white shadow-md ring-1 ring-black/5" style={{ width: dims ? dims.w : Math.min(baseW, 800), minHeight: dims ? undefined : Math.min(baseW * 1.414, 1130) }}>
      <canvas ref={canvasRef} className="block" />
      <canvas ref={annoRef} className="pointer-events-none absolute left-0 top-0" />
      <canvas ref={liveRef} className="pointer-events-none absolute left-0 top-0" />

      {/* sticky notes (DOM layer) */}
      {notes.map((nt) => (
        <div key={nt.id} className="absolute z-10" style={{ left: `${nt.x * 100}%`, top: `${nt.y * 100}%` }}>
          {editing?.page === n && editing.id === nt.id ? (
            <textarea
              autoFocus
              dir="auto"
              value={nt.text}
              placeholder={notePh}
              onChange={(e) => onNoteText(n, nt.id, e.target.value)}
              onBlur={() => onCloseEditor(n, nt.id)}
              className="pointer-events-auto absolute top-2 start-2 z-20 w-56 rounded-xl border border-line bg-surface p-2 text-sm shadow-lg outline-none"
              style={{ minHeight: 72 }}
            />
          ) : (
            <button
              type="button"
              aria-label="note"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onEditNote(n, nt.id)}
              className="pointer-events-auto absolute -top-2.5 -start-2.5 h-5 w-5 rounded-md ring-1 ring-black/20 shadow"
              style={{ background: nt.color }}
              title={nt.text || undefined}
            />
          )}
        </div>
      ))}

      {tool !== 'pointer' && (
        <div
          className="absolute inset-0 z-[5]"
          style={{ touchAction: 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      )}
    </div>
  )
}

export default function PdfReader({
  fileId, url, name, t,
}: {
  fileId: string
  url: string
  name: string
  t: Dict['reader']
}) {
  const [doc, setDoc] = useState<PdfDocument | null>(null)
  const [err, setErr] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<Tool>('pointer')
  const [color, setColor] = useState(COLORS[0].v)
  const [pages, setPages] = useState<Record<number, Item[]>>({})
  const [cur, setCur] = useState(1)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [editing, setEditing] = useState<{ page: number; id: string } | null>(null)
  const [wrapW, setWrapW] = useState(0)

  const pagesRef = useRef<Record<number, Item[]>>({})
  const history = useRef<{ page: number; items: Item[] }[]>([])
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const wrapRef = useRef<HTMLDivElement>(null)

  // load the PDF + the previously saved annotations
  const killDoc = useRef<(() => void) | null>(null)
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer()
        const pdfjs = await getPdfjs()
        const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) })
        if (dead) { task.destroy(); return }
        const d = await task.promise
        if (dead) { task.destroy(); return }
        killDoc.current = () => task.destroy()
        setDoc(d)
      } catch {
        if (!dead) setErr(true)
      }
    })()
    fetch(`/api/pdf-notes?fileId=${fileId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!dead && j?.pages) {
          const p: Record<number, Item[]> = {}
          for (const [k, v] of Object.entries(j.pages as Record<string, Item[]>)) p[Number(k)] = Array.isArray(v) ? (v as Item[]) : []
          pagesRef.current = p
          setPages(p)
        }
      })
      .catch(() => {})
    return () => { dead = true; killDoc.current?.() }
  }, [fileId, url])

  // measure the scroll column to fit pages to its width
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => setWrapW(es[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const flush = useCallback(
    async (page: number) => {
      setSaveState('saving')
      try {
        await fetch('/api/pdf-notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fileId, page, items: pagesRef.current[page] ?? [] }),
        })
        setSaveState('saved')
      } catch {}
    },
    [fileId],
  )

  const scheduleSave = useCallback(
    (page: number) => {
      clearTimeout(timers.current[page])
      timers.current[page] = setTimeout(() => void flush(page), 600)
    },
    [flush],
  )

  const commit = useCallback(
    (page: number, items: Item[]) => {
      pagesRef.current = { ...pagesRef.current, [page]: items }
      setPages(pagesRef.current)
      scheduleSave(page)
    },
    [scheduleSave],
  )

  const pushHistory = useCallback((page: number) => {
    history.current.push({ page, items: pagesRef.current[page] ?? [] })
    if (history.current.length > 80) history.current.shift()
  }, [])

  const undo = useCallback(() => {
    const h = history.current.pop()
    if (!h) return
    commit(h.page, h.items)
  }, [commit])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [undo])

  const erase = useCallback(
    (page: number, at: Pt) => {
      const items = pagesRef.current[page] ?? []
      const th = 0.014
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]
        const hit =
          it.kind === 'hl'
            ? at.x >= it.x - 0.005 && at.x <= it.x + it.w + 0.005 && at.y >= it.y - 0.005 && at.y <= it.y + it.h + 0.005
            : it.kind === 'pen'
              ? it.pts.some((v, k) => k % 2 === 0 && Math.abs(it.pts[k] - at.x) < th && Math.abs(it.pts[k + 1] - at.y) < th)
              : Math.abs(it.x - at.x) < 0.03 && Math.abs(it.y - at.y) < 0.03
        if (hit) {
          pushHistory(page)
          commit(page, items.filter((x) => x.id !== it.id))
          return
        }
      }
    },
    [commit, pushHistory],
  )

  const addNote = useCallback(
    (page: number, at: Pt) => {
      pushHistory(page)
      const id = uid()
      commit(page, [...(pagesRef.current[page] ?? []), { id, kind: 'note', color, x: at.x, y: at.y, text: '' }])
      setEditing({ page, id })
      setTool('pointer')
    },
    [color, commit, pushHistory],
  )

  const editNote = useCallback((page: number, id: string) => {
    pushHistory(page)
    setEditing({ page, id })
  }, [pushHistory])

  const noteText = useCallback(
    (page: number, id: string, text: string) => {
      const items = (pagesRef.current[page] ?? []).map((it) => (it.id === id && it.kind === 'note' ? { ...it, text } : it))
      pagesRef.current = { ...pagesRef.current, [page]: items }
      setPages(pagesRef.current)
    },
    [],
  )

  const closeEditor = useCallback(
    (page: number, id: string) => {
      setEditing(null)
      const items = (pagesRef.current[page] ?? []).filter((it) => !(it.id === id && it.kind === 'note' && !it.text.trim()))
      commit(page, items)
    },
    [commit],
  )

  const goTo = (p: number) => pageRefs.current.get(p)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const total = doc?.numPages ?? 0

  if (err) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="muted">{t.loadFail}</p>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => window.location.reload()}>
          {t.back}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* toolbar */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1.5 border-b border-line bg-surface/95 px-1 py-2 backdrop-blur">
        <ToolBtn label={t.pointer} active={tool === 'pointer'} onClick={() => setTool('pointer')}>{Ico.hand}</ToolBtn>
        <ToolBtn label={t.pen} active={tool === 'pen'} onClick={() => setTool('pen')}>{Ico.pen}</ToolBtn>
        <ToolBtn label={t.highlight} active={tool === 'hl'} onClick={() => setTool('hl')}>{Ico.hl}</ToolBtn>
        <ToolBtn label={t.note} active={tool === 'note'} onClick={() => setTool('note')}>{Ico.note}</ToolBtn>
        <ToolBtn label={t.eraser} active={tool === 'eraser'} onClick={() => setTool('eraser')}>{Ico.eraser}</ToolBtn>

        <span className="mx-1 h-5 w-px bg-line" aria-hidden />

        {COLORS.map((c) => (
          <button
            key={c.k}
            type="button"
            title={t.colors[c.k]}
            aria-label={t.colors[c.k]}
            aria-pressed={color === c.v}
            onClick={() => setColor(c.v)}
            className={`h-6 w-6 rounded-full ring-1 ring-black/20 transition ${color === c.v ? 'scale-110 ring-2 ring-brand' : ''}`}
            style={{ background: c.v }}
          />
        ))}

        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <ToolBtn label={t.undo} onClick={undo}>{Ico.undo}</ToolBtn>

        <span className="ms-auto flex items-center gap-1.5">
          <span className="chip select-none" dir="ltr">
            {t.page} {cur}{total ? ` / ${total}` : ''}
          </span>
          <ToolBtn label={t.zoomOut} onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.25).toFixed(2)))}>
            <path d="M5 12h14" fill="none" strokeWidth="1.8" strokeLinecap="round" />
          </ToolBtn>
          <span className="text-xs font-semibold muted tabular-nums" dir="ltr">{Math.round(zoom * 100)}%</span>
          <ToolBtn label={t.zoomIn} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.25).toFixed(2)))}>
            <path d="M12 5v14M5 12h14" fill="none" strokeWidth="1.8" strokeLinecap="round" />
          </ToolBtn>
          <span className={`chip select-none ${saveState === 'saving' ? 'chip-warn' : ''}`} aria-live="polite">
            {saveState === 'saving' ? t.saving : t.saved}
          </span>
        </span>
      </div>

      {/* pages */}
      <div ref={wrapRef} className="flex flex-col items-center gap-4">
        {!doc && !err && (
          <p className="muted flex items-center gap-2 py-16 text-sm"><span className="spinner" /> {name}</p>
        )}
        {doc && wrapW > 0 && (
          <div className="w-full" style={{ maxWidth: Math.min(860, wrapW) }}>
            {Array.from({ length: doc.numPages }, (_, k) => (
              <div key={k + 1} className="mb-4">
                <PageView
                  doc={doc}
                  n={k + 1}
                  baseW={Math.min(860, wrapW) - 8}
                  zoom={zoom}
                  items={pages[k + 1] ?? []}
                  tool={tool}
                  color={color}
                  editing={editing}
                  notePh={t.notePh}
                  onCommit={commit}
                  onErase={erase}
                  onAddNote={addNote}
                  onEditNote={editNote}
                  onNoteText={noteText}
                  onCloseEditor={closeEditor}
                  onVisible={setCur}
                  refCb={(p, el) => { if (el) pageRefs.current.set(p, el); else pageRefs.current.delete(p) }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
