'use client'

import { useState } from 'react'
import Icon from './Icon'
import Menu from './Menu'
import type { Dict } from '@/lib/dict'

// One button that turns the current output into a public /s/<token> link and
// hands it to WhatsApp / Telegram / the native share sheet / the clipboard.
// The link is created lazily on the first action and then reused (stable URL),
// so the menu never shows an intermediate dead end.

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
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const [copied, setCopied] = useState(false)

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

  return (
    <Menu
      label={labels.btn}
      panelClassName="w-64"
      trigger={
        <span className={`flex items-center gap-2 ${err ? 'text-danger' : ''}`}>
          <Icon name={err ? 'filex' : 'share'} className="h-4 w-4" />
          {err ? labels.fail : busy ? labels.creating : labels.btn}
        </span>
      }
    >
      {(close) => (
        <div className="flex flex-col">
          {busy && !url && (
            <p className="muted px-2 py-1.5 text-sm">{labels.creating}</p>
          )}
          {typeof navigator.share === 'function' && (
            <button
              type="button"
              disabled={busy && !url}
              className="menu-item disabled:opacity-50"
              onClick={() => act((u) => { navigator.share({ title: text, url: u }).catch(() => {}); close() })}
            >
              <Icon name="share" className="h-4 w-4" />
              {labels.native}
            </button>
          )}
          <button
            type="button"
            disabled={busy && !url}
            className="menu-item disabled:opacity-50"
            onClick={() => act((u) => { window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${u}`)}`, '_blank', 'noopener'); close() })}
          >
            <Icon name="send" className="h-4 w-4" />
            {labels.wa}
          </button>
          <button
            type="button"
            disabled={busy && !url}
            className="menu-item disabled:opacity-50"
            onClick={() => act((u) => { window.open(`https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener'); close() })}
          >
            <Icon name="send" className="h-4 w-4" />
            {labels.tg}
          </button>
          <button
            type="button"
            disabled={busy && !url}
            className="menu-item disabled:opacity-50"
            onClick={() => act(async (u) => { try { await navigator.clipboard.writeText(u); setCopied(true); setTimeout(() => setCopied(false), 3000) } catch {} })}
          >
            <Icon name={copied ? 'check' : 'link'} className="h-4 w-4" />
            {copied ? labels.copied : labels.copy}
          </button>
        </div>
      )}
    </Menu>
  )
}
