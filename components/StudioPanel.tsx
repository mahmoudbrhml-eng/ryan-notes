'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Icon, { type IconName } from './Icon'
import type { Dict } from '@/lib/dict'
import type { FileKind } from '@/lib/filekind'

export type StudioFile = {
  id: string
  name: string
  kind: FileKind
  mime: string
  url: string
  isLink: boolean
  status: 'idle' | 'processing' | 'done' | 'error'
  error: string | null
  transcript: boolean
  summary: boolean
  quiz: boolean
}
export type Tab = 'overview' | 'chat' | 'transcript' | 'summary' | 'focus' | 'quiz' | 'flash'
type NLang = 'ar' | 'en' | 'fa'
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

// Retries network failures and empty 5xx replies; a message from the server is shown as is.
async function postJson(url: string, body: object, fallback: string): Promise<Resp> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => null)) as Resp | null
      if (r.ok) return j ?? {}
      if (j?.error) throw new Error(j.error)
    } catch (e) {
      if (!(e instanceof TypeError)) throw e
    }
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
  }
  throw new Error(fallback)
}

function Sel<T extends string | number>({
  label, value, onChange, options,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: { v: T; l: string }[]
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold">
      <span className="muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}
        className="field !rounded-xl !py-2 !text-sm"
      >
        {options.map((o) => (
          <option key={String(o.v)} value={o.v}>{o.l}</option>
        ))}
      </select>
    </label>
  )
}

export default function StudioPanel({
  subjectId, files, activeId, tab, generated, mode, hideOnMobile, t,
}: {
  subjectId: string
  files: StudioFile[]
  activeId: string | null
  tab: Tab
  generated: { kind: 'transcript' | 'summary' | 'quiz'; date: string }[]
  mode: string
  hideOnMobile: boolean
  t: Dict
}) {
  const router = useRouter()
  const file = files.find((f) => f.id === activeId) ?? null
  const [lang, setLang] = useState<NLang>('ar')
  const [length, setLength] = useState<'short' | 'detailed'>('detailed')
  const [count, setCount] = useState(10)
  const [level, setLevel] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [busy, setBusy] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const href = (k: Tab, p = 'studio') => `/subjects/${subjectId}?${activeId ? `f=${activeId}&` : ''}tab=${k}&p=${p}`
  const tiles: { key: string; icon: IconName; label: string; to: string; current: boolean }[] = [
    { key: 'chat', icon: 'spark', label: t.tools.chat, to: href('chat', 'notes'), current: tab === 'chat' && mode !== 'exam' },
    { key: 'viva', icon: 'mic', label: t.tools.viva, to: `${href('chat', 'notes')}&mode=exam`, current: tab === 'chat' && mode === 'exam' },
    { key: 'transcript', icon: 'file', label: t.tools.transcript, to: href('transcript'), current: tab === 'transcript' },
    { key: 'summary', icon: 'sumry', label: t.tools.summary, to: href('summary'), current: tab === 'summary' },
    { key: 'focus', icon: 'star', label: t.tools.focus, to: href('focus'), current: tab === 'focus' },
    { key: 'quiz', icon: 'quiz', label: t.tools.quiz, to: href('quiz'), current: tab === 'quiz' },
    { key: 'flash', icon: 'flash', label: t.tools.flash, to: href('flash'), current: tab === 'flash' },
  ]
  const langOpts = [
    { v: 'ar' as NLang, l: t.ai.langAr },
    { v: 'en' as NLang, l: t.ai.langEn },
    { v: 'fa' as NLang, l: t.ai.langFa },
  ]

  async function runTranscript(restart: boolean) {
    if (!file) return
    setBusy('transcript')
    setErr(null)
    setPct(0)
    try {
      setMsg(t.ai.preparing)
      const duration = file.kind === 'media' && file.url && !file.isLink ? await mediaDuration(file.url, file.mime.startsWith('video')) : 0
      const s = await postJson('/api/ai/transcribe', { action: 'start', fileId: file.id, lang, duration, restart }, t.ai.timeout)
      const total = s.total ?? 1
      const done = new Set(s.done ?? [])
      for (let i = 0; i < total; i++) {
        if (done.has(i)) {
          setPct(Math.round(((i + 1) / total) * 100))
          continue
        }
        setMsg(t.ai.part.replace('{i}', String(i + 1)).replace('{n}', String(total)))
        const c = await postJson('/api/ai/transcribe', { action: 'chunk', fileId: file.id, index: i }, t.ai.timeout)
        setPct(Math.round(((i + 1) / total) * 100))
        if (c.ended) break
      }
      setPct(100)
      router.push(`/subjects/${subjectId}?f=${file.id}&tab=transcript&p=notes`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.ai.timeout)
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  async function runSimple(kind: 'summary' | 'quiz') {
    if (!file) return
    setBusy(kind)
    setErr(null)
    setMsg(t.studio.working)
    try {
      await postJson(
        `/api/ai/${kind}`,
        kind === 'summary' ? { fileId: file.id, lang, length } : { fileId: file.id, lang, count, level },
        t.ai.timeout
      )
      router.push(`/subjects/${subjectId}?f=${file.id}&tab=${tab === 'flash' ? 'flash' : kind}&p=notes`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.ai.timeout)
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  const needT = file && !file.transcript
  const hasTranscriptWork = !!file && (file.transcript || file.status !== 'idle')
  const shownError = err ?? (file && tab === 'transcript' && file.status === 'error' ? file.error : null)

  return (
    <aside className={`panel flex flex-col gap-4 p-4 ${hideOnMobile ? 'max-[1099px]:hidden' : ''}`}>
      <h2 className="font-semibold">{t.ws.studio}</h2>

      <div className="grid grid-cols-2 gap-2">
        {tiles.map((x) => (
          <Link key={x.key} scroll={false} href={x.to} aria-current={x.current ? 'page' : undefined} className="stile">
            <Icon name={x.icon} className="h-[18px] w-[18px]" />
            <span className="min-w-0 flex-1 truncate">{x.label}</span>
          </Link>
        ))}
      </div>

      {/* ---- options for the selected tool ---- */}
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface2/40 p-3">
        {!file ? (
          <p className="muted text-sm">{t.studio.noSource}</p>
        ) : (
          <>
            <div className="text-xs">
              <span className="muted">{t.studio.source}: </span>
              <b dir="auto">{file.name}</b>
            </div>

            {tab === 'overview' && <p className="muted text-xs leading-5">{t.ws.pickTool}</p>}
            {tab === 'chat' && <p className="muted text-xs leading-5">{mode === 'exam' ? t.studio.vivaInfo : t.studio.chatInfo}</p>}
            {tab === 'focus' && <p className="muted text-xs leading-5">{t.studio.focusInfo}</p>}

            {tab === 'transcript' &&
              (file.kind === 'unsupported' ? (
                <p className="muted text-xs leading-5">{t.ai.unsupported}</p>
              ) : (
                <>
                  <Sel label={t.studio.language} value={lang} onChange={setLang} options={langOpts} />
                  {busy === 'transcript' ? (
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold">
                        <span className="flex items-center gap-2"><span className="spinner" />{msg}</span>
                        <span dir="ltr">{pct}%</span>
                      </div>
                      <div className="bar"><i style={{ width: `${Math.max(pct, 4)}%` }} /></div>
                      <p className="muted mt-2 text-xs leading-5">{t.ai.keepOpen}</p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {file.status === 'done' ? (
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => confirm(t.ai.confirmRestart) && runTranscript(true)}>
                          {t.studio.regenerate}
                        </button>
                      ) : hasTranscriptWork ? (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => runTranscript(false)}>{t.ai.resume}</button>
                          <button type="button" className="btn btn-ghost btn-sm"
                            onClick={() => confirm(t.ai.confirmRestart) && runTranscript(true)}>{t.ai.restart}</button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => runTranscript(false)}>
                          {file.kind === 'media' ? t.ai.transcribe : t.ai.makeNotes}
                        </button>
                      )}
                    </div>
                  )}
                </>
              ))}

            {tab === 'summary' && (
              <>
                <Sel label={t.studio.language} value={lang} onChange={setLang} options={langOpts} />
                <Sel label={t.studio.length} value={length} onChange={setLength}
                  options={[{ v: 'short', l: t.studio.short }, { v: 'detailed', l: t.studio.detailed }]} />
                <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !!needT} onClick={() => runSimple('summary')}>
                  {busy === 'summary' && <span className="spinner" />}
                  {busy === 'summary' ? t.ai.summarizing : file.summary ? t.studio.regenerate : t.studio.generate}
                </button>
              </>
            )}

            {(tab === 'quiz' || tab === 'flash') && (
              <>
                {tab === 'flash' && <p className="muted text-xs leading-5">{t.studio.flashInfo}</p>}
                <Sel label={t.studio.language} value={lang} onChange={setLang} options={langOpts} />
                <div className="grid grid-cols-2 gap-2">
                  <Sel label={t.studio.count} value={count} onChange={setCount}
                    options={[10, 15, 20, 30].map((n) => ({ v: n, l: String(n) }))} />
                  <Sel label={t.studio.level} value={level} onChange={setLevel}
                    options={[
                      { v: 'easy', l: t.studio.easy }, { v: 'medium', l: t.studio.medium }, { v: 'hard', l: t.studio.hard },
                    ]} />
                </div>
                <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !!needT} onClick={() => runSimple('quiz')}>
                  {busy === 'quiz' && <span className="spinner" />}
                  {busy === 'quiz' ? t.studio.working : file.quiz ? t.studio.regenerate : t.studio.generate}
                </button>
              </>
            )}

            {needT && (tab === 'summary' || tab === 'quiz' || tab === 'flash') && (
              <p className="text-xs leading-5 text-warn">{t.studio.needTranscript}</p>
            )}
            {shownError && <p role="alert" dir="auto" className="text-xs leading-5 text-danger">{shownError}</p>}
          </>
        )}
      </div>

      {generated.length > 0 && (
        <div>
          <h3 className="muted mb-2 text-xs font-semibold uppercase tracking-wide">{t.ws.generated}</h3>
          <ul className="flex flex-col gap-2">
            {generated.map((g) => (
              <li key={g.kind} className="flex items-center gap-3 rounded-2xl border border-line p-3">
                <span className="tile !h-10 !w-10 bg-brand-soft text-brand">
                  <Icon name={g.kind === 'transcript' ? 'file' : g.kind === 'summary' ? 'sumry' : 'quiz'} className="h-4 w-4" />
                </span>
                <Link scroll={false} href={href(g.kind, 'notes')} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{t.tools[g.kind]}</span>
                  <span className="muted text-xs">{g.date}</span>
                </Link>
                {g.kind !== 'quiz' && (
                  <a href={`/subjects/${subjectId}/print?f=${activeId}&k=${g.kind}`} target="_blank" rel="noreferrer"
                    aria-label={t.pdf.pdf} title={t.pdf.pdf} className="btn btn-ghost btn-icon !h-8 !w-8">
                    <Icon name="download" className="h-4 w-4" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
