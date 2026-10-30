'use client'

import { useEffect, useRef, useState } from 'react'
import type { Dict } from '@/lib/dict'

export type Q = { q: string; o: string[]; a: number; ex: string }

export default function QuizRunner({
  questions,
  mode,
  t,
  rtl,
}: {
  questions: Q[]
  mode: 'quiz' | 'flash'
  t: Dict['quiz']
  rtl?: boolean
}) {
  return mode === 'quiz' ? <Quiz questions={questions} t={t} rtl={rtl} /> : <Flash questions={questions} t={t} rtl={rtl} />
}

// Shared navigation: horizontal swipe on the card area (mirrored for RTL —
// never hijacks vertical scrolling) plus keyboard arrows/digits. onNext returns
// false when advancing is not allowed, so keys and swipes stay honest.
function useNav({
  onPrev,
  onNext,
  onDigit,
  digitCount,
  rtl,
}: {
  onPrev: () => void
  onNext: () => boolean
  onDigit?: (i: number) => void
  digitCount?: number
  rtl?: boolean
}) {
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const tt = e.touches[0]
    touch.current = { x: tt.clientX, y: tt.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const st = touch.current
    touch.current = null
    if (!st) return
    const tt = e.changedTouches[0]
    const dx = tt.clientX - st.x
    const dy = tt.clientY - st.y
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return // that was a scroll
    const forward = rtl ? dx > 0 : dx < 0
    if (forward) onNext()
    else onPrev()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      // Arrows must keep working even when an option button holds focus (the
      // normal state right after answering) — only text fields swallow them.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const onButton = !!el && (el.tagName === 'BUTTON' || el.tagName === 'SELECT')
      const fwd = rtl ? 'ArrowLeft' : 'ArrowRight'
      const back = rtl ? 'ArrowRight' : 'ArrowLeft'
      if (e.key === fwd || e.key === 'ArrowDown' || e.key === 'Enter') {
        if (onButton && e.key === 'Enter') return // Enter keeps its native button role
        if (onNext()) e.preventDefault()
      } else if (e.key === back || e.key === 'ArrowUp') {
        onPrev()
        e.preventDefault()
      } else if (onDigit && digitCount && !onButton && /^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1
        if (i < digitCount) {
          onDigit(i)
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return { onTouchStart, onTouchEnd }
}

function Quiz({ questions, t, rtl }: { questions: Q[]; t: Dict['quiz']; rtl?: boolean }) {
  const [order, setOrder] = useState<number[]>(() => questions.map((_, i) => i))
  const [pos, setPos] = useState(0)
  // One pick per POSITION (not per question) so going back shows the exact
  // state the question was answered in, and Next walks forward through it.
  const [picks, setPicks] = useState<(number | null)[]>(() => questions.map(() => null))
  const [done, setDone] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  const picked = picks[pos]
  const q = questions[order[pos]]
  const score = order.reduce((s, qi, p) => s + (picks[p] !== null && picks[p] === questions[qi].a ? 1 : 0), 0)
  const answered = picks.filter((x) => x !== null).length
  const wrong = order.filter((_, p) => picks[p] !== null && picks[p] !== questions[order[p]].a)

  function restart(list: number[]) {
    setOrder(list)
    setPos(0)
    setPicks(list.map(() => null))
    setDone(false)
  }

  const pick = (i: number) => {
    if (picks[pos] !== null) return
    setPicks((w) => w.map((x, p) => (p === pos ? i : x)))
  }
  const next = () => {
    if (picked === null) return false
    if (pos + 1 >= order.length) setDone(true)
    else setPos(pos + 1)
    return true
  }
  const prev = () => setPos((p) => Math.max(0, p - 1))

  // Long answers push the buttons below the fold on phones: always bring the
  // question back into view when moving between questions.
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [pos])

  const nav = useNav({ onPrev: prev, onNext: next, onDigit: pick, digitCount: q.o.length, rtl })

  if (done) {
    const pct = Math.round((score / order.length) * 100)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-8 text-center">
        <div className="grid h-28 w-28 place-items-center rounded-full bg-brand-soft text-3xl font-extrabold text-brand" dir="ltr">
          {pct}%
        </div>
        <p className="text-lg font-semibold">
          {t.score.replace('{s}', String(score)).replace('{n}', String(order.length))}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {wrong.length > 0 && (
            <button type="button" className="btn btn-primary" onClick={() => restart(wrong)}>{t.retryWrong}</button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => restart(questions.map((_, i) => i))}>
            {t.restart}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4" {...nav}>
      <div ref={topRef} className="scroll-mt-24">
        <div className="muted mb-2 flex justify-between text-sm">
          <span>{t.qOf.replace('{i}', String(pos + 1)).replace('{n}', String(order.length))}</span>
          <span dir="ltr">{score}/{answered}</span>
        </div>
        <div className="bar"><i style={{ width: `${(answered / order.length) * 100}%` }} /></div>
      </div>

      <h3 dir="auto" className="text-lg font-semibold leading-8">{q.q}</h3>

      <div className="flex flex-col gap-2">
        {q.o.map((o, i) => {
          const state =
            picked === null ? '' : i === q.a ? 'border-brand bg-brand-soft' : i === picked ? 'border-danger bg-danger/10' : 'opacity-60'
          return (
            <button
              key={i}
              type="button"
              disabled={picked !== null}
              onClick={() => pick(i)}
              className={`flex items-start gap-3 rounded-2xl border border-line p-3.5 text-start transition hover:bg-surface2 ${state}`}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface2 text-xs font-bold">
                {String.fromCharCode(65 + i)}
              </span>
              <span dir="auto" className="leading-7">{o}</span>
            </button>
          )
        })}
      </div>

      {picked !== null && (
        <div className="rounded-2xl border border-line bg-surface2/50 p-4">
          <p className={`mb-1 font-bold ${picked === q.a ? 'text-brand' : 'text-danger'}`}>
            {picked === q.a ? t.correct : t.wrong}
          </p>
          <p dir="auto" className="leading-7">{q.ex}</p>
        </div>
      )}

      <div className="flex justify-between">
        <button type="button" className="btn btn-ghost" disabled={pos === 0} onClick={prev}>{t.prev}</button>
        <button type="button" className="btn btn-primary" disabled={picked === null} onClick={() => void next()}>
          {pos + 1 >= order.length ? t.finish : t.next}
        </button>
      </div>
    </div>
  )
}

function Flash({ questions, t, rtl }: { questions: Q[]; t: Dict['quiz']; rtl?: boolean }) {
  const [pos, setPos] = useState(0)
  const [flip, setFlip] = useState(false)
  const q = questions[pos]
  const go = (n: number) => {
    setPos(n)
    setFlip(false)
  }
  const next = () => {
    if (pos + 1 >= questions.length) return false
    go(pos + 1)
    return true
  }
  const prev = () => {
    if (pos > 0) go(pos - 1)
  }

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [pos])

  const nav = useNav({ onPrev: prev, onNext: next, rtl })
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4" {...nav}>
      <p className="muted text-center text-sm">
        {t.qOf.replace('{i}', String(pos + 1)).replace('{n}', String(questions.length))} · {t.flip}
      </p>
      <button
        type="button"
        onClick={() => setFlip((f) => !f)}
        aria-pressed={flip}
        className="panel flex min-h-[280px] flex-col items-center justify-center gap-3 p-8 text-center transition hover:bg-surface2"
      >
        {flip ? (
          <>
            <span className="chip">{t.answer}</span>
            <p dir="auto" className="text-lg font-semibold leading-8">{q.o[q.a]}</p>
            {q.ex && <p dir="auto" className="muted leading-7">{q.ex}</p>}
          </>
        ) : (
          <p dir="auto" className="text-xl font-semibold leading-9">{q.q}</p>
        )}
      </button>
      <div className="flex justify-between">
        <button type="button" className="btn btn-ghost" disabled={pos === 0} onClick={prev}>{t.prev}</button>
        <button type="button" className="btn btn-primary" disabled={pos + 1 >= questions.length} onClick={next}>
          {t.next}
        </button>
      </div>
    </div>
  )
}
