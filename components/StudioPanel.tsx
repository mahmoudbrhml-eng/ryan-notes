'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ApiError, postJson } from '@/lib/client-api'
import { useJobs, type JobFile } from './Jobs'
import Icon, { type IconName } from './Icon'
import { useSelection } from './Selection'
import { matchPartGroup } from '@/lib/parts'
import type { Dict } from '@/lib/dict'
import type { FileKind } from '@/lib/filekind'

export type StudioFile = {
  id: string
  name: string
  path: string
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
export type Tab = 'overview' | 'chat' | 'transcript' | 'summary' | 'focus' | 'quiz' | 'flash' | 'combo'
type NLang = 'ar' | 'en' | 'fa' | 'custom'
type JobKind = 'notes' | 'summary' | 'quiz'

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
  subjectId, files, activeId, tab, generated, combos, activeCombo, mode, hideOnMobile, t,
}: {
  subjectId: string
  files: StudioFile[]
  activeId: string | null
  tab: Tab
  generated: { kind: 'transcript' | 'summary' | 'quiz'; date: string }[]
  combos: { id: string; title: string; date: string }[]
  activeCombo: string | null
  mode: string
  hideOnMobile: boolean
  t: Dict
}) {
  const router = useRouter()
  const sel = useSelection()
  const jobs = useJobs()
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const file = files.find((f) => f.id === activeId) ?? null
  const selFiles = files.filter((f) => sel.selected.includes(f.id))
  const missing = selFiles.filter((f) => !f.transcript || f.status !== 'done')
  // Split-file parts ("Lecture (1-3).mp3"…) merge verbatim on the server, so
  // the selection box can promise a lossless, instant join.
  const partsGroup = selFiles.length >= 2 ? matchPartGroup(selFiles.map((f) => f.name)) : null
  const [lang, setLang] = useState<NLang>('ar')
  const [custom, setCustom] = useState('')
  const [mjob, setMjob] = useState<JobKind>('notes')
  const [length, setLength] = useState<'short' | 'detailed'>('detailed')
  const [count, setCount] = useState(10)
  const [level, setLevel] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [busy, setBusy] = useState<{ kind: string; fileId: string | null } | null>(null)
  const [err, setErr] = useState<{ fileId: string | null; text: string } | null>(null)

  const href = (k: Tab, p = 'studio') => `/subjects/${subjectId}?${activeId ? `f=${activeId}&` : ''}tab=${k}&p=${p}`
  const friendly = (e: unknown) => {
    if (e instanceof ApiError) return (t.errors as Record<string, string>)[e.code] ?? e.message
    return e instanceof Error ? e.message : t.errors.other
  }
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
    { v: 'custom' as NLang, l: t.ai.langCustom },
  ]
  const customText = lang === 'custom' ? custom.trim().slice(0, 600) : undefined

  // The custom-prompt field: only shown when the user picks “Custom prompt”.
  const customField = lang === 'custom' && (
    <>
      <textarea
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        dir="auto"
        rows={3}
        maxLength={600}
        placeholder={t.ai.customPh}
        aria-label={t.ai.langCustom}
        className="field resize-y !text-sm"
      />
      <p className="muted text-xs leading-5">{t.studio.customHint}</p>
    </>
  )

  const toJob = (f: StudioFile): JobFile => ({
    id: f.id, name: f.name, path: f.path, kind: f.kind, mime: f.mime, url: f.url, isLink: f.isLink, subjectId,
  })
  const job = file ? jobs.jobs[file.id] : undefined
  const jobRunning = job?.state === 'running'

  function runTranscript(restart: boolean) {
    if (file) jobs.start(toJob(file), lang === 'custom' ? 'ar' : lang, restart, customText)
  }

  function transcribeMissing() {
    jobs.startMany(missing.map(toJob), lang === 'custom' ? 'ar' : lang, customText)
  }

  async function createCombo() {
    setBusy({ kind: 'combo', fileId: null })
    setErr(null)
    try {
      const r = await postJson('/api/ai/merge', {
        subjectId,
        fileIds: selFiles.map((f) => f.id),
        lang: lang === 'custom' ? 'ar' : lang,
        custom: customText,
        job: mjob,
      })
      sel.clear()
      router.push(`/subjects/${subjectId}?tab=combo&m=${r.id}&p=notes`)
    } catch (e) {
      setErr({ fileId: null, text: friendly(e) })
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  async function runSimple(kind: 'summary' | 'quiz') {
    if (!file) return
    const fid = file.id
    setBusy({ kind, fileId: fid })
    setErr(null)
    try {
      await postJson(`/api/ai/${kind}`, kind === 'summary' ? { fileId: fid, lang: lang === 'custom' ? 'ar' : lang, length, custom: customText } : { fileId: fid, lang: lang === 'custom' ? 'ar' : lang, count, level, custom: customText })
      // Only jump to the result if you are still looking at the same source.
      if (activeRef.current === fid) router.push(`/subjects/${subjectId}?f=${fid}&tab=${tab === 'flash' ? 'flash' : kind}&p=notes`)
    } catch (e) {
      setErr({ fileId: fid, text: friendly(e) })
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  const needT = file && !file.transcript
  const hasWork = !!file && (file.transcript || file.status !== 'idle')
  const busyHere = !!busy && busy.fileId === (file?.id ?? null)
  const comboBusy = busy?.kind === 'combo'
  const shownError =
    (err && err.fileId === (file?.id ?? null) ? err.text : null) ??
    (job?.state === 'error' ? job.error : null) ??
    (file && tab === 'transcript' && file.status === 'error' ? file.error : null)

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

      {jobRunning && job && (
        <div className="rounded-2xl bg-surface2 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold">
            <span className="flex min-w-0 items-center gap-2"><span className="spinner shrink-0" /><span className="truncate">{job.msg}</span></span>
            <span dir="ltr">{job.pct}%</span>
          </div>
          <div className="bar"><i style={{ width: `${Math.max(job.pct, 4)}%` }} /></div>
          <p className="muted mt-2 text-xs leading-5">{t.ai.keepOpen}</p>
        </div>
      )}

      {/* ---- several sources selected: combine ---- */}
      {selFiles.length >= 2 && (
        <div className="flex flex-col gap-3 rounded-2xl bg-brand-soft p-3">
          <div>
            <div className="text-sm font-bold text-brand">{t.studio.comboTitle} · {selFiles.length}</div>
            <p className="muted mt-1 text-xs leading-5">{partsGroup ? t.studio.partsHint : t.studio.comboHint}</p>
          </div>
          <ul className="space-y-1.5 text-xs">
            {selFiles.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2">
                <span dir="auto" className="truncate">{f.name}</span>
                <span className={`chip ${f.transcript && f.status === 'done' ? '' : 'chip-warn'}`}>
                  {f.transcript && f.status === 'done' ? t.ws.ready : t.ws.notYet}
                </span>
              </li>
            ))}
          </ul>
          <Sel label={t.studio.language} value={lang} onChange={setLang} options={langOpts} />
          {customField}
          <Sel label={t.studio.job} value={mjob} onChange={setMjob}
            options={[{ v: 'notes' as JobKind, l: t.studio.jobNotes }, { v: 'summary' as JobKind, l: t.studio.jobSummary }, { v: 'quiz' as JobKind, l: t.studio.jobQuiz }]} />
          {missing.length > 0 ? (
            <button type="button" className="btn btn-primary btn-sm" disabled={missing.some((f) => jobs.jobs[f.id]?.state === 'running')} onClick={transcribeMissing}>
              {t.studio.transcribeMissing.replace('{n}', String(missing.length))}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" disabled={comboBusy} onClick={createCombo}>
              {comboBusy && <span className="spinner" />}
              {comboBusy ? t.studio.working : mjob === 'summary' ? t.studio.createSummary : mjob === 'quiz' ? t.studio.createQuiz : t.studio.createCombo}
            </button>
          )}
        </div>
      )}

      {/* ---- options for the selected tool ---- */}
      <div className="flex flex-col gap-3 rounded-2xl bg-surface2/70 p-3">
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
                  {customField}
                  <div className="flex flex-wrap gap-2">
                    {file.status === 'done' ? (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={jobRunning}
                        onClick={() => confirm(t.ai.confirmRestart) && runTranscript(true)}>
                        {t.studio.regenerate}
                      </button>
                    ) : hasWork ? (
                      <>
                        <button type="button" className="btn btn-primary btn-sm" disabled={jobRunning} onClick={() => runTranscript(false)}>{t.ai.resume}</button>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={jobRunning}
                          onClick={() => confirm(t.ai.confirmRestart) && runTranscript(true)}>{t.ai.restart}</button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-primary btn-sm" disabled={jobRunning} onClick={() => runTranscript(false)}>
                        {file.kind === 'media' ? t.ai.transcribe : t.ai.makeNotes}
                      </button>
                    )}
                  </div>
                </>
              ))}

            {tab === 'summary' && (
              <>
                <Sel label={t.studio.language} value={lang} onChange={setLang} options={langOpts} />
                {customField}
                <Sel label={t.studio.length} value={length} onChange={setLength}
                  options={[{ v: 'short', l: t.studio.short }, { v: 'detailed', l: t.studio.detailed }]} />
                <button type="button" className="btn btn-primary btn-sm" disabled={busyHere || !!needT} onClick={() => runSimple('summary')}>
                  {busyHere && busy?.kind === 'summary' && <span className="spinner" />}
                  {busyHere && busy?.kind === 'summary' ? t.ai.summarizing : file.summary ? t.studio.regenerate : t.studio.generate}
                </button>
              </>
            )}

            {(tab === 'quiz' || tab === 'flash') && (
              <>
                {tab === 'flash' && <p className="muted text-xs leading-5">{t.studio.flashInfo}</p>}
                <Sel label={t.studio.language} value={lang} onChange={setLang} options={langOpts} />
                {customField}
                <div className="grid grid-cols-2 gap-2">
                  <Sel label={t.studio.count} value={count} onChange={setCount} options={[10, 15, 20, 30].map((n) => ({ v: n, l: String(n) }))} />
                  <Sel label={t.studio.level} value={level} onChange={setLevel}
                    options={[{ v: 'easy', l: t.studio.easy }, { v: 'medium', l: t.studio.medium }, { v: 'hard', l: t.studio.hard }]} />
                </div>
                <button type="button" className="btn btn-primary btn-sm" disabled={busyHere || !!needT} onClick={() => runSimple('quiz')}>
                  {busyHere && busy?.kind === 'quiz' && <span className="spinner" />}
                  {busyHere && busy?.kind === 'quiz' ? t.studio.working : file.quiz ? t.studio.regenerate : t.studio.generate}
                </button>
              </>
            )}

            {needT && (tab === 'summary' || tab === 'quiz' || tab === 'flash') && (
              <p className="text-xs leading-5 text-warn">{t.studio.needTranscript}</p>
            )}
          </>
        )}
        {shownError && <p role="alert" dir="auto" className="text-xs leading-5 text-danger">{shownError}</p>}
      </div>

      {generated.length > 0 && (
        <div>
          <h3 className="muted mb-2 text-xs font-semibold">{t.ws.generated}</h3>
          <ul className="flex flex-col gap-2">
            {generated.map((g) => (
              <li key={g.kind} className="flex items-center gap-3 rounded-2xl bg-surface2/70 p-3">
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

      {combos.length > 0 && (
        <div>
          <h3 className="muted mb-2 text-xs font-semibold">{t.ws.combos}</h3>
          <ul className="flex flex-col gap-2">
            {combos.map((c) => (
              <li key={c.id} className={`flex items-center gap-3 rounded-2xl p-3 ${c.id === activeCombo && tab === 'combo' ? 'bg-brand-soft' : 'bg-surface2/70'}`}>
                <span className="tile !h-10 !w-10 bg-brand-soft text-brand"><Icon name="mind" className="h-4 w-4" /></span>
                <Link scroll={false} href={`/subjects/${subjectId}?tab=combo&m=${c.id}&p=notes`} className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-sm font-semibold">{c.title}</span>
                  <span className="muted text-xs">{c.date}</span>
                </Link>
                <a href={`/subjects/${subjectId}/print?k=merged&m=${c.id}`} target="_blank" rel="noreferrer"
                  aria-label={t.pdf.pdf} title={t.pdf.pdf} className="btn btn-ghost btn-icon !h-8 !w-8">
                  <Icon name="download" className="h-4 w-4" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
