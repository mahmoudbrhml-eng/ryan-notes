'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Icon from './Icon'
import { ApiError, postJson, sendJson } from '@/lib/client-api'
import type { Dict } from '@/lib/dict'

// The interactive half of the Study plan page (the page itself is a server
// component). Optimistic toggle/delete; the add form posts and merges the
// new rows locally so the plan never flashes or reorders.

export type PlanItem = {
  id: string
  title: string
  day: string // YYYY-MM-DD
  kind: 'review' | 'task'
  done: boolean
  subject_name: string | null
}

type StudyDict = Dict['study']

const fmtDay = (iso: string, locale: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })

export default function PlannerList({ initial, t, today, locale }: {
  initial: PlanItem[]
  t: StudyDict
  today: string
  locale: string
}) {
  const router = useRouter()
  const [items, setItems] = useState<PlanItem[]>(initial)
  const [title, setTitle] = useState('')
  const [day, setDay] = useState(today)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const groups = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.day.localeCompare(b.day) || Number(a.done) - Number(b.done))
    const overdue = sorted.filter((x) => !x.done && x.day < today)
    const rest = sorted.filter((x) => x.done || x.day >= today)
    const map = new Map<string, PlanItem[]>()
    for (const x of rest) {
      const arr = map.get(x.day) ?? []
      arr.push(x)
      map.set(x.day, arr)
    }
    return { overdue, days: [...map.entries()] }
  }, [items, today])

  const doneToday = items.filter((x) => x.day === today && x.done).length
  const todayCount = items.filter((x) => x.day === today).length

  async function toggle(x: PlanItem) {
    const next = !x.done
    setItems((cur) => cur.map((i) => (i.id === x.id ? { ...i, done: next } : i)))
    try {
      await sendJson('/api/planner', { id: x.id, done: next }, 'PATCH')
    } catch {
      setItems((cur) => cur.map((i) => (i.id === x.id ? { ...i, done: !next } : i)))
      setErr(t.err)
    }
  }

  async function remove(x: PlanItem) {
    const snapshot = items
    setItems((cur) => cur.filter((i) => i.id !== x.id))
    try {
      await sendJson('/api/planner', { id: x.id }, 'DELETE')
    } catch {
      setItems(snapshot)
      setErr(t.err)
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault()
    const titleClean = title.trim()
    if (!titleClean || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await postJson('/api/planner', { title: titleClean, day })
      setItems((cur) => [...cur, {
        id: (r as { id?: string }).id ?? crypto.randomUUID(),
        title: titleClean, day, kind: 'task', done: false, subject_name: null,
      }])
      setTitle('')
      router.refresh()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : t.err)
    } finally {
      setBusy(false)
    }
  }

  const dayLabel = (d: string) =>
    d === today ? t.today : d === addDaysStr(today, 1) ? t.tomorrow : fmtDay(d, locale)

  return (
    <div className="flex flex-col gap-4">
      {/* add task */}
      <form onSubmit={addTask} className="panel flex flex-wrap items-end gap-2 p-4">
        <label className="min-w-0 flex-1 basis-56 flex-col gap-1 text-xs font-semibold">
          <span className="sr-only">{t.add}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            dir="auto"
            placeholder={t.addPh}
            className="field !py-2 !text-sm"
            aria-label={t.add}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold">
          <span className="muted">{t.date}</span>
          <input
            type="date"
            value={day}
            min={addDaysStr(today, -90)}
            max={addDaysStr(today, 365)}
            onChange={(e) => setDay(e.target.value || today)}
            dir="ltr"
            className="field !py-2 !text-sm"
            aria-label={t.date}
          />
        </label>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>
          {busy && <span className="spinner" />}
          {t.add}
        </button>
      </form>

      {err && <p role="alert" className="text-xs leading-5 text-danger">{err}</p>}

      {/* today's progress */}
      {todayCount > 0 && (
        <div className="rounded-2xl bg-brand-soft px-4 py-3 text-sm font-semibold text-brand">
          {doneToday === todayCount && todayCount > 0 ? t.allDone : t.progress.replace('{n}', String(doneToday)).replace('{m}', String(todayCount))}
        </div>
      )}

      {items.length === 0 ? (
        <section className="panel flex flex-col gap-2 p-6 text-center">
          <Icon name="cal" className="mx-auto h-8 w-8 text-brand" />
          <p className="font-semibold">{t.empty}</p>
          <p className="muted text-sm leading-6">{t.emptyHint}</p>
        </section>
      ) : (
        <>
          {groups.overdue.length > 0 && (
            <PlanGroup label={t.overdue} items={groups.overdue} t={t} onToggle={toggle} onRemove={remove} warn />
          )}
          {groups.days.map(([d, list]) => (
            <PlanGroup key={d} label={dayLabel(d)} items={list} t={t} onToggle={toggle} onRemove={remove} warn={d < today} />
          ))}
        </>
      )}
    </div>
  )
}

function addDaysStr(base: string, n: number) {
  return new Date(Date.parse(`${base}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

function PlanGroup({ label, items, t, onToggle, onRemove, warn }: {
  label: string
  items: PlanItem[]
  t: StudyDict
  onToggle: (x: PlanItem) => void
  onRemove: (x: PlanItem) => void
  warn?: boolean
}) {
  return (
    <section className={`panel flex flex-col gap-1 p-4 ${warn ? 'border-warn/40' : ''}`}>
      <h2 className={`mb-1 text-sm font-bold ${warn ? 'text-warn' : 'muted'}`}>{label}</h2>
      <ul className="flex flex-col">
        {items.map((x) => (
          <li key={x.id} className="flex items-center gap-3 rounded-xl px-1 py-2 hover:bg-surface2/50">
            <button
              type="button"
              onClick={() => onToggle(x)}
              aria-pressed={x.done}
              aria-label={x.title}
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors ${x.done ? 'border-brand bg-brand text-brand-fg' : 'border-line text-transparent hover:border-brand'}`}
            >
              <Icon name="check" className="h-3.5 w-3.5" />
            </button>
            <span dir="auto" className={`min-w-0 flex-1 truncate text-sm ${x.done ? 'muted line-through' : 'font-medium'}`}>
              {x.title}
            </span>
            {x.subject_name && <span className="chip hidden shrink-0 sm:inline-flex">{x.subject_name}</span>}
            <span className={`chip shrink-0 ${x.kind === 'review' ? '' : 'chip-warn'}`}>
              {x.kind === 'review' ? t.review : t.task}
            </span>
            <button
              type="button"
              onClick={() => onRemove(x)}
              aria-label={t.del}
              title={t.del}
              className="btn btn-ghost btn-icon !h-8 !w-8 shrink-0 text-danger"
            >
              <Icon name="trash" className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
