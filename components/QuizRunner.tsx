'use client'

import { useState } from 'react'
import type { Dict } from '@/lib/dict'

export type Q = { q: string; o: string[]; a: number; ex: string }

export default function QuizRunner({
  questions,
  mode,
  t,
}: {
  questions: Q[]
  mode: 'quiz' | 'flash'
  t: Dict['quiz']
}) {
  return mode === 'quiz' ? <Quiz questions={questions} t={t} /> : <Flash questions={questions} t={t} />
}

function Quiz({ questions, t }: { questions: Q[]; t: Dict['quiz'] }) {
  const [order, setOrder] = useState<number[]>(() => questions.map((_, i) => i))
  const [pos, setPos] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [wrong, setWrong] = useState<number[]>([])
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)

  function restart(list: number[]) {
    setOrder(list)
    setPos(0)
    setPicked(null)
    setWrong([])
    setScore(0)
    setDone(false)
  }

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

  const q = questions[order[pos]]
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <div className="muted mb-2 flex justify-between text-sm">
          <span>{t.qOf.replace('{i}', String(pos + 1)).replace('{n}', String(order.length))}</span>
          <span dir="ltr">{score}/{pos + (picked !== null ? 1 : 0)}</span>
        </div>
        <div className="bar"><i style={{ width: `${((pos + (picked !== null ? 1 : 0)) / order.length) * 100}%` }} /></div>
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
              onClick={() => {
                setPicked(i)
                if (i === q.a) setScore((s) => s + 1)
                else setWrong((w) => [...w, order[pos]])
              }}
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

      <div className="flex justify-end">
        <button type="button" className="btn btn-primary" disabled={picked === null} onClick={() => {
          if (pos + 1 >= order.length) setDone(true)
          else {
            setPos(pos + 1)
            setPicked(null)
          }
        }}>
          {pos + 1 >= order.length ? t.finish : t.next}
        </button>
      </div>
    </div>
  )
}

function Flash({ questions, t }: { questions: Q[]; t: Dict['quiz'] }) {
  const [pos, setPos] = useState(0)
  const [flip, setFlip] = useState(false)
  const q = questions[pos]
  const go = (n: number) => {
    setPos(n)
    setFlip(false)
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
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
        <button type="button" className="btn btn-ghost" disabled={pos === 0} onClick={() => go(pos - 1)}>{t.prev}</button>
        <button type="button" className="btn btn-primary" disabled={pos + 1 >= questions.length} onClick={() => go(pos + 1)}>
          {t.next}
        </button>
      </div>
    </div>
  )
}
