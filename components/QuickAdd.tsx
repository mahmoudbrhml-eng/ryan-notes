'use client'

// Quick source adder that lives INSIDE the subject page (notes header): while
// reading any note you can add a new one without switching panels or leaving.
// It runs the exact same shared pipeline as the Sources panel (lib/upload),
// so big files are compressed/split in the browser first, and progress shows
// in a small floating pill above the bottom navigation.

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { prepareAndUpload, type PrepStage } from '@/lib/upload'
import Icon from './Icon'
import Menu from './Menu'
import type { Dict } from '@/lib/dict'

type Item = {
  key: string
  name: string
  state: 'tooling' | 'compressing' | 'splitting' | 'uploading' | 'error'
  error?: string
  pct?: number
}

export default function QuickAdd({
  subjectId, userId, t,
}: {
  subjectId: string
  userId: string
  t: Dict
}) {
  const router = useRouter()
  const picker = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [modal, setModal] = useState<null | 'text' | 'link'>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const patch = (key: string, p: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)))

  async function uploadFiles(list: File[]) {
    if (list.length === 0) return
    const queued: Item[] = list.map((f) => ({ key: crypto.randomUUID(), name: f.name, state: 'uploading' }))
    setItems((xs) => [...xs, ...queued])
    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      const key = queued[i].key
      const r = await prepareAndUpload(file, {
        userId,
        subjectId,
        msgs: { storageLimit: t.src.storageLimit, compressBigFail: t.src.compressBigFail, splitFail: t.src.splitFail, tooBig: t.upload.tooBig, planSize: t.src.planSize },
        on: (s: PrepStage, pct?: number) => patch(key, { state: s, pct }),
      })
      if (r.ok) {
        setItems((xs) => xs.filter((x) => x.key !== key))
        router.refresh()
      } else {
        patch(key, { state: 'error', error: r.error })
      }
    }
  }

  async function addText() {
    const text = body.trim()
    if (!text) return
    const name = `${(title.trim() || 'Text').slice(0, 80)}.txt`
    setModal(null)
    setTitle('')
    setBody('')
    await uploadFiles([new File([text], name, { type: 'text/plain' })])
  }

  async function addLink() {
    if (!url.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/api/sources/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId, url: url.trim() }),
      })
      const j = (await r.json().catch(() => null)) as { error?: string } | null
      if (!r.ok) throw new Error(j?.error ?? 'Could not add this link.')
      setModal(null)
      setUrl('')
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const active = items.filter((x) => x.state !== 'error').length

  return (
    <>
      <Menu
        label={t.ws.add}
        trigger={<><Icon name="plus" className="h-4 w-4" /><span className="hidden sm:inline">{t.ws.add}</span></>}
        className="btn btn-soft btn-sm"
      >
        {(close) => (
          <>
            <button type="button" className="menu-item" onClick={() => { close(); picker.current?.click() }}>
              <Icon name="up" className="h-4 w-4" />{t.src.upload}
            </button>
            <button type="button" className="menu-item" onClick={() => { close(); setTitle(''); setBody(''); setModal('text') }}>
              <Icon name="text" className="h-4 w-4" />{t.src.addText}
            </button>
            <button type="button" className="menu-item" onClick={() => { close(); setErr(null); setUrl(''); setModal('link') }}>
              <Icon name="link" className="h-4 w-4" />{t.src.addLink}
            </button>
          </>
        )}
      </Menu>

      <input
        ref={picker}
        type="file"
        multiple
        className="sr-only"
        accept=".pdf,.pptx,.docx,.txt,.md,image/*,audio/*,video/*"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? [])
          e.target.value = ''
          uploadFiles(list)
        }}
      />

      {/* floating progress pill — visible while reading, above the mobile nav */}
      {items.length > 0 && (
        <div
          className="panel fixed bottom-20 end-4 z-40 flex max-w-[min(20rem,calc(100%-2rem))] flex-col gap-2 p-3 shadow-lg min-[1100px]:bottom-4"
          role="status"
        >
          <div className="flex items-center justify-between gap-2 text-xs font-semibold">
            <span className="flex items-center gap-1.5">
              {active > 0 ? <span className="spinner" /> : <Icon name="close" className="h-3.5 w-3.5 text-danger" />}
              {active > 0 ? t.src.uploading : t.src.failed}
            </span>
            {active === 0 && (
              <button type="button" className="btn btn-ghost btn-icon !h-6 !w-6" aria-label={t.src.dismiss}
                onClick={() => setItems([])}>
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {items.map((x) => (
            <div key={x.key} className="min-w-0">
              <div dir="auto" className="truncate text-xs font-semibold">{x.name}</div>
              <div className={`text-xs ${x.state === 'error' ? 'text-danger' : 'muted'}`} dir="auto">
                {x.state === 'error'
                  ? `${t.src.failed}: ${x.error ?? ''}`
                  : x.state === 'compressing'
                    ? `${t.src.compressing} ${x.pct ?? 0}%`
                    : x.state === 'splitting'
                      ? `${t.src.splitting} ${x.pct ?? 0}%`
                      : x.state === 'tooling'
                        ? t.src.prepTool
                        : t.src.uploading}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setModal(null)}>
          <div role="dialog" aria-modal="true" className="panel w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{modal === 'text' ? t.src.addText : t.src.addLink}</h2>
              <button type="button" className="btn btn-ghost btn-icon" aria-label={t.ws.close} onClick={() => setModal(null)}>
                <Icon name="close" className="h-[18px] w-[18px]" />
              </button>
            </div>

            {modal === 'text' ? (
              <div className="flex flex-col gap-3">
                <input value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" aria-label={t.src.textTitle}
                  placeholder={t.src.textTitle} maxLength={80} className="field" />
                <textarea value={body} onChange={(e) => setBody(e.target.value)} dir="auto" aria-label={t.src.textBody}
                  placeholder={t.src.textBody} rows={9} className="field resize-y" />
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>{t.src.cancel}</button>
                  <button type="button" className="btn btn-primary" disabled={!body.trim()} onClick={addText}>{t.src.add}</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" type="url" aria-label={t.src.linkLabel}
                  placeholder="https://" className="field" autoFocus />
                <p className="muted text-xs leading-5">{t.src.linkHint}</p>
                {err && <p role="alert" dir="auto" className="text-sm text-danger">{err}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>{t.src.cancel}</button>
                  <button type="button" className="btn btn-primary" disabled={busy || !url.trim()} onClick={addLink}>
                    {busy && <span className="spinner" />}
                    {busy ? t.src.adding : t.src.add}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
