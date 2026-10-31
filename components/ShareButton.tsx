'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import type { Dict } from '@/lib/dict'

// One button that turns the current output into a public /s/<token> link and
// hands it to WhatsApp / Telegram / the native share sheet / the clipboard.
// The link is created lazily on the first action and then reused (stable URL).
//
// The dropdown is portaled to <body> with fixed positioning: the reading
// section is an overflow:auto scroller and would otherwise clip a plain
// absolute dropdown that hangs past its edge (seen on the transcript tab,
// where the button wraps to its own row near the panel border).

const PANEL_W = 272

export default function ShareButton({
  kind,
  fileId,
  comboId,
  shareTitle,
  labels,
}: {
  kind: 'summary' | 'transcript' | 'quiz' | 'combo'
  fileId?: string
  comboId?: string
  shareTitle: string
  labels: Dict['share']
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const [copied, setCopied] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.min(Math.max(8, r.left), window.innerWidth - PANEL_W - 8)
    const top = Math.min(r.bottom + 8, window.innerHeight - 230)
    setPos({ top, left })
  }
  useLayoutEffect(() => {
    if (open) place()
    // reposition when the panel's content (and height) changes
  }, [open, url, busy, err, copied])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    // fixed panels don't scroll with the page: re-anchor to the trigger live
    const onMove = () => place()
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  const create = async (): Promise<string | null> => {
    if (url) return url
    setBusy(true)
    setErr(false)
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, fileId, comboId }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string }
      if (!res.ok || !data.url) throw new Error('no url')
      setUrl(data.url)
      return data.url
    } catch {
      setErr(true)
      setTimeout(() => setErr(false), 3000)
      return null
    } finally {
      setBusy(false)
    }
  }

  const act = async (go: (u: string) => void) => {
    const u = await create()
    if (u) go(u)
  }

  const text = `${shareTitle} — Ryan Notes`
  const item = 'menu-item w-full disabled:opacity-50'

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`btn btn-ghost btn-sm ${err ? '!text-danger' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={err ? 'filex' : 'share'} className="h-4 w-4" />
        {err ? labels.fail : busy ? labels.creating : labels.btn}
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="menu"
          className="panel fixed z-[70] flex flex-col p-2 shadow-xl"
          style={{ top: pos.top, left: pos.left, width: PANEL_W }}
        >
          {busy && !url && <p className="muted px-2 py-1.5 text-sm">{labels.creating}</p>}
          {typeof navigator.share === 'function' && (
            <button
              type="button"
              disabled={busy && !url}
              className={item}
              onClick={() => act((u) => { navigator.share({ title: text, url: u }).catch(() => {}); setOpen(false) })}
            >
              <Icon name="share" className="h-4 w-4" />
              {labels.native}
            </button>
          )}
          <button
            type="button"
            disabled={busy && !url}
            className={item}
            onClick={() => act((u) => { window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${u}`)}`, '_blank', 'noopener'); setOpen(false) })}
          >
            <Icon name="send" className="h-4 w-4" />
            {labels.wa}
          </button>
          <button
            type="button"
            disabled={busy && !url}
            className={item}
            onClick={() => act((u) => { window.open(`https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener'); setOpen(false) })}
          >
            <Icon name="send" className="h-4 w-4" />
            {labels.tg}
          </button>
          <button
            type="button"
            disabled={busy && !url}
            className={item}
            onClick={() => act(async (u) => {
              try { await navigator.clipboard.writeText(u); setCopied(true); setTimeout(() => setCopied(false), 3000) } catch {}
            })}
          >
            <Icon name={copied ? 'check' : 'link'} className="h-4 w-4" />
            {copied ? labels.copied : labels.copy}
          </button>
        </div>,
        document.body
      )}
    </>
  )
}
