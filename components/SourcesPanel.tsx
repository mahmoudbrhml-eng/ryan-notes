'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { compressMedia, splitPdf, compressImage, looksLikePdf, looksLikeImage } from '@/lib/compress'
import { deleteFile } from '@/app/subjects/[id]/actions'
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

// Supabase caps every stored object (~50MB on the free plan) no matter what the
// bucket config says, so nothing above ~48MB may go to storage untouched:
// - audio/video above COMPRESS_ABOVE is compressed to a small mono MP3 in the
//   browser first (lib/compress), which is also what keeps uploads fast;
// - PDFs above COMPRESS_ABOVE are split into several smaller sources with no
//   quality loss;
// - images above COMPRESS_ABOVE are re-encoded as JPEG until they fit.
// If the in-browser tool fails, only files that already fit are uploaded
// as-is; anything bigger gets a clear message instead of a doomed upload.
const MAX_MEDIA = 1024 * 1024 * 1024 // media is streamed through the compressor
const MAX_DOC = 300 * 1024 * 1024 // PDFs are split in the browser first
const SAFE_RAW = 48 * 1024 * 1024 // largest object uploaded untouched
const COMPRESS_ABOVE = 45 * 1024 * 1024

const isMedia = (f: File) =>
  /^(audio|video)\//.test(f.type) ||
  /\.(mp3|m4a|wav|ogg|oga|aac|flac|mp4|webm|mov|mkv|avi|3gp|amr|opus|wma)$/i.test(f.name)

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
  const press = useRef<{ t: ReturnType<typeof setTimeout> | null; fired: boolean }>({ t: null, fired: false })
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

  async function uploadFiles(list: File[]) {
    if (list.length === 0) return
    const supabase = createClient()
    const items: Pending[] = list.map((f) => ({ key: crypto.randomUUID(), name: f.name, state: 'uploading' }))
    setPending((p) => [...items, ...p])
    const mark = (key: string, state: Pending['state'], error?: string, pct?: number) =>
      setPending((p) => p.map((x) => (x.key === key ? { ...x, state, error, pct } : x)))

    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      const key = items[i].key
      const media = isMedia(file)
      if (file.size > (media ? MAX_MEDIA : MAX_DOC)) {
        mark(key, 'error', t.upload.tooBig)
        continue
      }

      // Decide what actually goes to storage: the file itself, a compressed
      // version, or a list of PDF parts. Anything above the ~50MB storage cap
      // must be made smaller in the browser first; media is compressed from
      // 45MB up because that also makes uploads much faster.
      let up: File[] = [file]
      if (media && file.size > COMPRESS_ABOVE) {
        let ok = false
        for (let attempt = 0; !ok && attempt < 2; attempt++) {
          try {
            const r = await compressMedia(
              file,
              (pct) => mark(key, 'compressing', undefined, pct),
              (s) => mark(key, s === 'split' ? 'splitting' : 'tooling'),
            )
            up = r.files
            ok = true
          } catch {
            /* one retry, then fall through */
          }
        }
        if (!ok) {
          if (file.size > SAFE_RAW) {
            mark(key, 'error', t.src.compressBigFail)
            continue
          }
          up = [file] // small enough to upload as-is
        }
      } else if (looksLikePdf(file) && file.size > SAFE_RAW) {
        let parts: File[] | null = null
        for (let attempt = 0; !parts && attempt < 2; attempt++) {
          try {
            parts = await splitPdf(
              file,
              () => mark(key, 'tooling'),
              (a, b) => mark(key, 'splitting', undefined, Math.round((a / b) * 100)),
            )
          } catch {
            /* one retry, then fall through */
          }
        }
        if (!parts || parts.length === 0) {
          mark(key, 'error', t.src.splitFail)
          continue
        }
        up = parts
      } else if (looksLikeImage(file) && file.size > SAFE_RAW) {
        try {
          const small = await compressImage(file)
          if (!small) {
            mark(key, 'error', t.src.compressBigFail)
            continue
          }
          up = [small]
        } catch {
          mark(key, 'error', t.src.compressBigFail)
          continue
        }
      }

      let failed = false
      for (const upFile of up) {
        mark(key, 'uploading')
        const fileId = crypto.randomUUID()
        const isOriginal = upFile === file
        const finalName = isOriginal ? file.name : upFile.name
        const safe = finalName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
        const path = `${userId}/${subjectId}/${fileId}-${safe}`
        const { error: upErr } = await supabase.storage
          .from('lecture-files')
          .upload(path, upFile, { contentType: upFile.type || undefined, upsert: false })
        if (upErr) {
          mark(key, 'error', friendlyStorage(upErr.message))
          failed = true
          break
        }
        const { error: dbErr } = await supabase.from('files').insert({
          id: fileId, subject_id: subjectId, name: finalName, storage_path: path,
          mime: upFile.type || null, size_bytes: upFile.size,
        })
        if (dbErr) {
          await supabase.storage.from('lecture-files').remove([path])
          mark(key, 'error', dbErr.message)
          failed = true
          break
        }
      }
      if (!failed) mark(key, 'done')
      router.refresh()
    }

    function friendlyStorage(raw: string) {
      return /exceeded the maximum allowed size/i.test(raw) ? t.src.storageLimit : raw
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
        <h2 className="font-semibold">{t.ws.sources}</h2>
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
            <li key={f.id} className="source" data-active={sel.mode ? checked : f.id === activeId}>
              <div className="flex items-center gap-2">
                <Link
                  scroll={false}
                  href={`/subjects/${subjectId}?f=${f.id}&tab=overview&p=notes`}
                  className="flex min-w-0 flex-1 items-center gap-3 select-none"
                  style={{ WebkitTouchCallout: 'none' }}
                  onContextMenu={(e) => e.preventDefault()}
                  onPointerDown={() => {
                    press.current.fired = false
                    press.current.t = setTimeout(() => {
                      press.current.fired = true
                      sel.start(f.id)
                    }, 450)
                  }}
                  onPointerUp={() => press.current.t && clearTimeout(press.current.t)}
                  onPointerLeave={() => press.current.t && clearTimeout(press.current.t)}
                  onPointerCancel={() => press.current.t && clearTimeout(press.current.t)}
                  onClick={(e) => {
                    if (press.current.fired) {
                      e.preventDefault()
                      press.current.fired = false
                    } else if (sel.mode) {
                      e.preventDefault()
                      sel.toggle(f.id)
                    }
                  }}
                >
                  {sel.mode && (
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${checked ? 'border-brand bg-brand text-brand-fg' : 'border-line'}`}>
                      {checked && <Icon name="check" className="h-3.5 w-3.5" />}
                    </span>
                  )}
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
                    <>
                      <button type="button" className="menu-item" onClick={() => { close(); sel.start(f.id) }}>
                        <Icon name="check" className="h-4 w-4" />{t.src.select}
                      </button>
                      <form action={deleteFile}>
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="subjectId" value={subjectId} />
                        <ConfirmButton message={t.ws.confirmDelFile.replace('{name}', f.name)} className="menu-item danger">
                          <Icon name="trash" className="h-4 w-4" />
                          {t.ws.delFile}
                        </ConfirmButton>
                      </form>
                    </>
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
