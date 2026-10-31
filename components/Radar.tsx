'use client'

import { useCallback, useEffect, useState } from 'react'
import QuizRunner, { type Q, type Track } from './QuizRunner'
import type { Dict } from '@/lib/dict'

// Weakness Radar: reads the student's own aggregated attempts and turns them
// into action — which lecture is slipping, which questions keep coming back,
// and a one-tap practice quiz generated against exactly those weak spots.

type RadarData = {
  overall: { total: number; acc: number; recent: number; recentAcc: number }
  files: { file_id: string; name: string; total: number; acc: number }[]
  weak: { q: string; wrong: number; total: number }[]
}

const barColor = (acc: number) => (acc >= 75 ? 'bg-brand' : acc >= 50 ? 'bg-warn' : 'bg-danger')
const textColor = (acc: number) => (acc >= 75 ? 'text-brand' : acc >= 50 ? 'text-warn' : 'text-danger')

export default function Radar({
  subjectId,
  t,
  quizT,
  rtl,
}: {
  subjectId: string
  t: Dict['radar']
  quizT: Dict['quiz']
  rtl: boolean
}) {
  const [data, setData] = useState<RadarData | null>(null)
  const [state, setState] = useState<'load' | 'ready' | 'err'>('load')
  const [phase, setPhase] = useState<'radar' | 'building' | 'quiz'>('radar')
  const [questions, setQuestions] = useState<Q[]>([])
  const [err, setErr] = useState('')

  const load = useCallback(() => {
    setState('load')
    fetch(`/api/radar?subject=${subjectId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: RadarData) => {
        setData(d)
        setState('ready')
      })
      .catch(() => setState('err'))
  }, [subjectId])

  useEffect(load, [load])

  const practice = async () => {
    setErr('')
    setPhase('building')
    try {
      const r = await fetch('/api/ai/practice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId }),
      })
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; questions?: Q[]; error?: string }
      if (!r.ok || !d.ok || !d.questions?.length) throw new Error(d.error || t.err)
      setQuestions(d.questions)
      setPhase('quiz')
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : t.err)
      setPhase('radar')
    }
  }

  if (phase === 'quiz') {
    return (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          className="btn btn-ghost btn-sm w-fit"
          onClick={() => {
            setPhase('radar')
            load()
          }}
        >
          ← {t.back}
        </button>
        <QuizRunner questions={questions} mode="quiz" t={quizT} rtl={rtl} track={{ subjectId }} />
      </div>
    )
  }

  if (state === 'load') return <p className="muted py-10 text-center">…</p>
  if (state === 'err')
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <p className="muted">{t.err}</p>
        <button type="button" className="btn btn-soft btn-sm" onClick={load}>{t.retry}</button>
      </div>
    )

  const d = data
  if (!d || d.overall.total === 0)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center">
        <span className="tile !h-14 !w-14 bg-brand-soft text-brand text-2xl" aria-hidden>🎯</span>
        <p className="font-semibold">{t.noData}</p>
        <p className="muted text-sm leading-6">{t.noDataHint}</p>
      </div>
    )

  const trend = d.overall.recent >= 5 ? (d.overall.recentAcc > d.overall.acc + 4 ? 'up' : d.overall.recentAcc < d.overall.acc - 4 ? 'down' : 'flat') : 'flat'
  const trendLabel = trend === 'up' ? t.up : trend === 'down' ? t.down : t.flat

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {/* Overall */}
      <div className="flex flex-wrap items-center justify-center gap-6 py-2 text-center">
        <div className="grid h-24 w-24 place-items-center rounded-full bg-brand-soft text-2xl font-extrabold text-brand" dir="ltr">
          {d.overall.acc}%
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <p className="font-semibold">{t.overall}</p>
          <p className="muted text-sm">{t.attempts.replace('{n}', String(d.overall.total))}</p>
          {d.overall.recent > 0 && (
            <p className="muted text-sm">
              {t.recent}: <b dir="ltr">{d.overall.recentAcc}%</b>
            </p>
          )}
          {d.overall.recent >= 5 && (
            <span className={`chip ${trend === 'up' ? '' : trend === 'down' ? 'chip-warn' : ''}`}>{trendLabel}</span>
          )}
        </div>
      </div>

      {/* Practice CTA — always available once there is data */}
      <div className="flex flex-col items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={phase === 'building'} onClick={() => void practice()}>
          {phase === 'building' ? t.practicing : `🎯 ${t.practice}`}
        </button>
        <p className="muted text-center text-xs leading-5">{t.practiceInfo}</p>
        {err && <p className="text-sm text-danger">{err}</p>}
      </div>

      {/* Per source */}
      {d.files.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold">{t.bySource}</h3>
          <div className="flex flex-col gap-2.5">
            {d.files.map((f) => (
              <div key={f.file_id} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span dir="auto" className="min-w-0 truncate text-sm font-semibold">{f.name}</span>
                  <span className={`shrink-0 text-sm font-bold ${textColor(f.acc)}`} dir="ltr">{f.acc}%</span>
                </div>
                <div className="bar"><i className={barColor(f.acc)} style={{ width: `${Math.max(f.acc, 3)}%` }} /></div>
                <span className="muted text-xs">{t.attempts.replace('{n}', String(f.total))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weakest questions */}
      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">{t.weakQ}</h3>
        {d.weak.length === 0 ? (
          <p className="muted text-sm">{t.noWeak}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {d.weak.map((w, i) => (
              <li key={i} dir="auto" className="rounded-2xl border border-danger/20 bg-danger/5 p-3.5">
                <p className="leading-7">{w.q}</p>
                <p className="muted mt-1 text-xs">{t.seen.replace('{w}', String(w.wrong)).replace('{n}', String(w.total))}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
