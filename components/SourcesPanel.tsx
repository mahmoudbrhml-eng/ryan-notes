'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { deleteFile } from '@/app/subjects/[id]/actions'
import { prepareAndUpload, type PrepStage } from '@/lib/upload'
import Icon, { type IconName } from './Icon'
import Menu from './Menu'
import { useSelection } from './Selection'
import ConfirmButton from './ConfirmButton'
import type { Dict } from '@/lib/dict'

export type SrcFile = { id: string; name: string; sub: string; icon: IconName }
type Pending = {
  key: string
  name: string
  state: 'tooling' | 'compressing' | 'splitting' | 'uploading' | 'done' | 'error'
  error?: string
  pct?: number
}

// One source adder used here and by the quick "+" button in the notes header
// (components/QuickAdd.tsx) — both run the same shared pipeline (lib/upload)
// so every file above the ~50MB storage cap is prepared in the browser first.
export default function SourcesPanel({
  subjectId, userId, files, activeId, hideOnMobile, t,
}: {
  subjectId: string
  userId: string
  files: SrcFile[]
  activeId: string | null
  hideOnMobile: boolean
  t: Dict
}) {
  const router = useRouter()
  const sel = useSelection()
  const picker = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [modal, setModal] = useState<null | 'text' | 'link'>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)

  // Once the server sends the fresh list, the temporary "uploading" rows are no longer needed.
  useEffect(() => {
    setPending((p) => p.filter((x) => x.state !== 'done'))
  }, [files])

  async function runOne(file: File, key: string) {
    const mark = (state: Pending['state'], error?: string, pct?: number) =>
      setPending((p) => p.map((x) => (x.key === key ? { ...x, state, error, pct } : x)))
    mark('uploading')
    const r = await prepareAndUpload(file, {
      userId,
      subjectId,
      msgs: { storageLimit: t.src.storageLimit, compressBigFail: t.src.compressBigFail, splitFail: t.src.splitFail, tooBig: t.upload.tooBig },
      on: (s: PrepStage, pct?: number) => mark(s, undefined, pct),
    })
    if (r.ok) mark('done')
    else mark('error', r.error)
    router.refresh()
  }

  async function uploadFiles(list: File[]) {
    if (list.length === 0) return
    const items: Pending[] = list.map((f) => ({ key: crypto.randomUUID(), name: f.name, state: 'uploading' }))
    setPending((p) => [...items, ...p])
    for (let i = 0; i < list.length; i++) {
      await runOne(list[i], items[i].key)
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

  const empty = files.length === 0 && pending.length === 0

  return (
    <section
      className={`panel flex flex-col gap-3 p-4 ${drag ? 'ring-2 ring-brand' : ''} ${hideOnMobile ? 'max-[1099px]:hidden' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        uploadFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">
          {t.ws.sources}
          {files.length > 0 && <span className="muted ms-2 text-sm font-normal">{files.length}</span>}
        </h2>
        <Menu
          label={t.ws.add}
          trigger={<><Icon name="plus" className="h-4 w-4" />{t.ws.add}</>}
          className="btn btn-soft btn-sm"
        >
          {(close) => (
            <>
              <button type="button" className="menu-item" onClick={() => { close(); picker.current?.click() }}>
                <Icon name="up" className="h-4 w-4" />{t.src.upload}
              </button>
              <button type="button" className="menu-item" onClick={() => { close(); setModal('text') }}>
                <Icon name="text" className="h-4 w-4" />{t.src.addText}
              </button>
              <button type="button" className="menu-item" onClick={() => { close(); setErr(null); setModal('link') }}>
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
      </div>

      {sel.mode && (
        <div className="flex items-center justify-between rounded-2xl bg-brand-soft px-3 py-2 text-sm font-semibold text-brand">
          <span>{t.src.selected.replace('{n}', String(sel.selected.length))}</span>
          <button type="button" className="btn btn-sm !px-3" onClick={sel.clear}>{t.src.done}</button>
        </div>
      )}

      {empty && <p className="muted py-8 text-center text-sm leading-6">{t.ws.noSources}</p>}

      <ul className="flex flex-col gap-1">
        {pending.map((p) => (
          <li key={p.key} className="source">
            <div className="flex items-center gap-3">
              <span className="tile !h-10 !w-10 bg-surface2 text-navy">
                {p.state === 'error' ? <Icon name="close" className="h-4 w-4 text-danger" /> : <span className="spinner" />}
              </span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-sm font-semibold">{p.name}</span>
                <span className={`text-xs ${p.state === 'error' ? 'text-danger' : 'muted'}`} dir="auto">
                  {p.state === 'error'
                    ? `${t.src.failed}: ${p.error ?? ''}`
                    : p.state === 'compressing'
                      ? `${t.src.compressing} ${p.pct ?? 0}%`
                      : p.state === 'splitting'
                        ? `${t.src.splitting} ${p.pct ?? 0}%`
                        : p.state === 'tooling'
                          ? t.src.prepTool
                          : t.src.uploading}
                </span>
              </span>
              {p.state === 'error' && (
                <button type="button" className="btn btn-ghost btn-icon !h-8 !w-8" aria-label={t.src.dismiss}
                  onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}>
                  <Icon name="close" className="h-4 w-4" />
                </button>
              )}
            </div>
          </li>
        ))}

        {files.map((f) => {
          const checked = sel.selected.includes(f.id)
          return (
            <li key={f.id} className="source" data-active={checked || f.id === activeId}>
              <div className="flex items-center gap-2">
                {/* Small always-visible tick box on the near edge: tap it to pick
                    this source for a batch job — tapping nothing is fine too. */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={t.src.select}
                  onClick={() => sel.toggle(f.id)}
                  className="grid !h-8 !w-8 shrink-0 place-items-center rounded-lg hover:bg-surface2"
                >
                  <span
                    className={`grid h-[18px] w-[18px] place-items-center rounded-md border transition-colors ${
                      checked ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-surface'
                    }`}
                  >
                    {checked && <Icon name="check" className="h-3 w-3" />}
                  </span>
                </button>
                <Link
                  scroll={false}
                  href={`/subjects/${subjectId}?f=${f.id}&tab=overview&p=notes`}
                  className="flex min-w-0 flex-1 items-center gap-3 select-none"
                >
                  <span className="tile !h-10 !w-10 bg-surface2 text-navy"><Icon name={f.icon} className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span dir="auto" className="block truncate text-sm font-semibold">{f.name}</span>
                    <span dir="ltr" className="muted block truncate text-xs">{f.sub}</span>
                  </span>
                </Link>
                <Menu
                  label={t.src.more}
                  trigger={<Icon name="more" className="h-[18px] w-[18px]" />}
                  className="btn btn-icon !h-8 !w-8 hover:bg-surface2"
                >
                  {(close) => (
                    <form action={deleteFile}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="subjectId" value={subjectId} />
                      <ConfirmButton message={t.ws.confirmDelFile.replace('{name}', f.name)} className="menu-item danger">
                        <Icon name="trash" className="h-4 w-4" />
                        {t.ws.delFile}
                      </ConfirmButton>
                    </form>
                  )}
                </Menu>
              </div>
            </li>
          )
        })}
      </ul>

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
    </section>
  )
}
