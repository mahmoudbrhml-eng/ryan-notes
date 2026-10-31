'use client'

// Shared UI pieces for the PDF tools page — built on the site's existing
// classes (.panel/.btn/.chip/.dropzone/.bar) so it matches the app everywhere.

import { useRef, useState, type ReactNode } from 'react'
import Icon from '@/components/Icon'
import { fmtSize } from '@/lib/format'

export type Entry = { id: string; file: File }

export function fmt(name: string, vars: Record<string, string | number>): string {
  let out = name
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  return out
}

// ---------- dropzone ----------

export function Drop({
  multiple,
  accept,
  onFiles,
  label,
  compact,
}: {
  multiple?: boolean
  accept: string
  onFiles: (files: File[]) => void
  label: string
  compact?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const handle = (list: FileList | null) => {
    if (list?.length) onFiles([...list])
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      className={`dropzone ${compact ? 'py-5' : ''} ${over ? '!border-brand' : ''}`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files) }}
    >
      <Icon name="up" className="h-6 w-6" />
      <span className="text-sm font-semibold">{label}</span>
      <input
        ref={input} type="file" accept={accept} multiple={multiple} className="sr-only" tabIndex={-1}
        aria-label={label}
        onChange={(e) => { handle(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}

// ---------- file list with reordering ----------

export function Rows({
  entries,
  onMove,
  onRemove,
  t,
}: {
  entries: Entry[]
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
  t: { up: string; down: string; rm: string }
}) {
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e, i) => (
        <li key={e.id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface2 px-3 py-2.5">
          <Icon name="file" className="h-4 w-4 shrink-0 text-brand" />
          <span dir="auto" className="min-w-0 flex-1 truncate text-sm font-semibold">{e.file.name}</span>
          <span className="muted hidden shrink-0 text-xs sm:block">{fmtSize(e.file.size)}</span>
          <span className="flex shrink-0 items-center">
            <button type="button" className="btn btn-ghost btn-icon !h-8 !w-8" disabled={i === 0}
              aria-label={t.up} title={t.up} onClick={() => onMove(e.id, -1)}>
              <Icon name="chevU" className="h-4 w-4" />
            </button>
            <button type="button" className="btn btn-ghost btn-icon !h-8 !w-8" disabled={i === entries.length - 1}
              aria-label={t.down} title={t.down} onClick={() => onMove(e.id, 1)}>
              <Icon name="chevD" className="h-4 w-4" />
            </button>
            <button type="button" className="btn btn-ghost btn-icon !h-8 !w-8 text-danger" aria-label={t.rm} title={t.rm}
              onClick={() => onRemove(e.id)}>
              <Icon name="close" className="h-4 w-4" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------- busy / error / result ----------

export function Busy({ label, pct }: { label: string; pct?: number }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10" role="status">
      <span className="spinner !h-7 !w-7 text-brand" />
      <p className="text-sm font-semibold">{label}</p>
      {pct !== undefined && (
        <div className="bar w-56"><i style={{ width: `${Math.round(pct * 100)}%` }} /></div>
      )}
    </div>
  )
}

export function ErrBox({ msg }: { msg: string }) {
  return (
    <p className="rounded-2xl px-4 py-3 text-sm font-semibold text-danger" style={{ background: 'var(--warn-soft)' }} role="alert">
      {msg}
    </p>
  )
}

export function Result({
  title, name, size, onAgain, onReset, labels,
}: {
  title: string
  name: string
  size: number
  onAgain: () => void
  onReset: () => void
  labels: { resultTitle: string; again: string; reset: string }
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl px-4 py-8 text-center" style={{ background: 'var(--brand-soft)' }}>
      <span className="tile bg-brand text-[color:var(--brand-fg)]">
        <Icon name="check" className="h-6 w-6" />
      </span>
      <p className="font-bold">{title}</p>
      <p dir="auto" className="muted max-w-full truncate text-sm">{name} · {fmtSize(size)}</p>
      <div className="flex gap-2 pt-1">
        <button type="button" className="btn btn-primary btn-sm" onClick={onAgain}>
          <Icon name="download" className="h-4 w-4" />
          {labels.again}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>{labels.reset}</button>
      </div>
    </div>
  )
}

// ---------- tool frame ----------

export function ToolFrame({
  title, onBack, backLabel, children,
}: {
  title: string
  onBack: () => void
  backLabel: string
  children: ReactNode
}) {
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <button type="button" onClick={onBack} className="btn btn-ghost btn-sm self-start">
        <Icon name="back" className="h-4 w-4 rtl:rotate-180" />
        {backLabel}
      </button>
      <div className="panel flex flex-col gap-4 p-5 md:p-6">
        <h2 className="text-lg font-bold">{title}</h2>
        {children}
      </div>
    </section>
  )
}
