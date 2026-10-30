'use client'

import { useState } from 'react'
import Link from 'next/link'
import Icon from './Icon'
import ConfirmButton from './ConfirmButton'
import SubmitButton from './SubmitButton'
import UsageBadge from './UsageBadge'
import { createSubject, deleteSubject } from '@/app/subjects/actions'
import type { Dict } from '@/lib/dict'

export type SubjectItem = { id: string; name: string; files: number; date: string; tint: number }

export default function SubjectsBrowser({
  items, t, usage,
}: {
  items: SubjectItem[]
  t: Dict['home']
  usage: Dict['usage']
}) {
  const [q, setQ] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [adding, setAdding] = useState(false)
  const shown = items.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-6">
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold">{t.title}</h1>
          <UsageBadge t={usage} />
        </div>
        <p className="muted mt-1">{t.sub}</p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" className="muted pointer-events-none absolute start-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            dir="auto"
            aria-label={t.search}
            placeholder={t.search}
            className="field !rounded-full !ps-11"
          />
        </div>
        <div className="flex rounded-full border border-line p-1" role="group">
          {(['grid', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              aria-label={v === 'grid' ? t.grid : t.list}
              className={`btn btn-icon !h-8 !w-8 ${view === v ? 'btn-soft' : ''}`}
            >
              <Icon name={v === 'grid' ? 'grid' : 'list'} className="h-4 w-4" />
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" className="h-[18px] w-[18px]" />
          {t.newSubject}
        </button>
      </div>

      {adding && (
        <form
          action={async (fd) => {
            await createSubject(fd)
            setAdding(false)
          }}
          className="panel mb-6 flex flex-wrap items-center gap-3 p-4"
        >
          <input name="name" required autoFocus maxLength={120} dir="auto" aria-label={t.newSubject}
            placeholder={t.namePh} className="field min-w-[220px] flex-1" />
          <SubmitButton>{t.create}</SubmitButton>
          <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>{t.cancel}</button>
        </form>
      )}

      {items.length === 0 && !adding && (
        <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="tile h-16 w-16 bg-brand-soft text-brand"><Icon name="cap" className="h-8 w-8" /></span>
          <h2 className="text-xl font-semibold">{t.empty}</h2>
          <p className="muted max-w-sm">{t.emptySub}</p>
          <button type="button" className="btn btn-primary mt-2" onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-[18px] w-[18px]" />
            {t.newSubject}
          </button>
        </div>
      )}

      {items.length > 0 && shown.length === 0 && <p className="muted py-10 text-center">{t.noMatch}</p>}

      <section
        className={view === 'grid' ? 'grid gap-4' : 'flex flex-col gap-3'}
        style={view === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))' } : undefined}
      >
        {shown.map((s) => (
          <div
            key={s.id}
            className={`subject-card ${view === 'list' ? 'subject-row' : ''}`}
            style={{ '--tint': `var(--t${s.tint})` } as React.CSSProperties}
          >
            <Link href={`/subjects/${s.id}`} className="absolute inset-0 rounded-[inherit]" aria-label={s.name} />
            <span className="tile a-i bg-surface/70 text-navy"><Icon name="cap" /></span>
            <form action={deleteSubject} className="a-d relative z-10">
              <input type="hidden" name="id" value={s.id} />
              <ConfirmButton
                message={t.confirmDel.replace('{name}', s.name)}
                className="btn btn-ghost btn-icon btn-danger !h-9 !w-9"
              >
                <Icon name="trash" className="h-4 w-4" />
                <span className="sr-only">{t.del}</span>
              </ConfirmButton>
            </form>
            <div className="a-t min-w-0">
              <h3 dir="auto" className="line-clamp-2 text-lg font-semibold leading-snug">{s.name}</h3>
              <p className="muted mt-1 text-sm">
                {s.date} · {t.files.replace('{n}', String(s.files))}
              </p>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
