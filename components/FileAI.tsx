'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Dict } from '@/lib/dict'
import type { FileKind } from '@/lib/filekind'

type Status = 'idle' | 'processing' | 'done' | 'error'
type Resp = { error?: string; total?: number; done?: number[]; ended?: boolean }

function mediaDuration(url: string, video: boolean): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(video ? 'video' : 'audio')
    const finish = (n: number) => {
      el.removeAttribute('src')
      resolve(Number.isFinite(n) ? n : 0)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => finish(el.duration)
    el.onerror = () => finish(0)
    setTimeout(() => finish(0), 10000)
    el.src = url
  })
}

export default function FileAI({
  fileId, subjectId, kind, mime, url, status, hasOutput, error, t,
}: {
  fileId: string
  subjectId: string
  kind: FileKind
  mime: string
  url: string
  status: Status
  hasOutput: boolean
  error: string | null
  t: Dict['ai']
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [lang, setLang] = useState<'ar' | 'en' | 'fa'>('ar')

  if (kind === 'unsupported') return <p className="muted mt-2 text-xs leading-5">{t.unsupported}</p>

  async function post(body: object): Promise<Resp> {
    const r = await fetch('/api/ai/transcribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = (await r.json().catch(() => null)) as Resp | null
    if (!r.ok) throw new Error(j?.error ?? t.timeout)
    return j ?? {}
  }

  async function run(restart: boolean) {
    setBusy(true)
    setErr(null)
    setPct(0)
    try {
      setMsg(t.preparing)
      const duration = kind === 'media' ? await mediaDuration(url, mime.startsWith('video')) : 0
      const s = await post({ action: 'start', fileId, lang, duration, restart })
      const total = s.total ?? 1
      const done = new Set(s.done ?? [])
      for (let i = 0; i < total; i++) {
        if (done.has(i)) {
          setPct(Math.round(((i + 1) / total) * 100))
          continue
        }
        setMsg(t.part.replace('{i}', String(i + 1)).replace('{n}', String(total)))
        const c = await post({ action: 'chunk', fileId, index: i, lang })
        setPct(Math.round(((i + 1) / total) * 100))
        if (c.ended) break
      }
      setPct(100)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.timeout)
    } finally {
      setBusy(false)
      router.refresh()
    }
  }

  const shownError = err ?? (status === 'error' ? error : null)
  const viewHref = `/subjects/${subjectId}?f=${fileId}&tab=transcript`

  return (
    <div className="mt-3 flex flex-col gap-2">
      {busy ? (
        <div className="rounded-2xl border border-line bg-surface2/60 p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold">
            <span className="flex items-center gap-2"><span className="spinner" />{msg}</span>
            <span dir="ltr">{pct}%</span>
          </div>
          <div className="bar"><i style={{ width: `${Math.max(pct, 4)}%` }} /></div>
          <p className="muted mt-2 text-xs leading-5">{t.keepOpen}</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {status === 'done' ? (
            <>
              <span className="chip">{t.done}</span>
              <Link href={viewHref} className="btn btn-soft btn-sm">{t.view}</Link>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => confirm(t.confirmRestart) && run(true)}>
                {t.restart}
              </button>
            </>
          ) : hasOutput || status !== 'idle' ? (
            <>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => run(false)}>{t.resume}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => confirm(t.confirmRestart) && run(true)}>
                {t.restart}
              </button>
              {hasOutput && <Link href={viewHref} className="muted text-xs underline">{t.partial}</Link>}
            </>
          ) : (
            <>
              <select aria-label={t.notesLang} value={lang} onChange={(e) => setLang(e.target.value as 'ar' | 'en' | 'fa')}
                className="field !w-auto !rounded-full !px-3 !py-1.5 !text-sm">
                <option value="ar">{t.langAr}</option>
                <option value="en">{t.langEn}</option>
                <option value="fa">{t.langFa}</option>
              </select>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => run(false)}>
                {kind === 'doc' || kind === 'text' ? t.makeNotes : t.transcribe}
              </button>
            </>
          )}
        </div>
      )}
      {shownError && <p role="alert" dir="auto" className="text-xs leading-5 text-danger">{shownError}</p>}
    </div>
  )
}
