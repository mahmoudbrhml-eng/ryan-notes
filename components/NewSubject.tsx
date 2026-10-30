'use client'

// "New subject" button for the app header: opens a tiny dialog and jumps
// straight into the fresh subject. Available everywhere — including from
// inside another subject — so nobody has to go back to the home page first.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addSubject } from '@/app/subjects/actions'
import Icon from './Icon'

export default function NewSubject({
  label,
  ph,
  create,
  cancel,
}: {
  label: string
  ph: string
  create: string
  cancel: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => field.current?.focus(), 30)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [open])

  async function go() {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    setErr(null)
    try {
      const id = await addSubject(n)
      setOpen(false)
      setName('')
      if (id) router.push(`/subjects/${id}`)
      else router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-soft btn-sm whitespace-nowrap"
        title={label}
        onClick={() => {
          setErr(null)
          setOpen(true)
        }}
      >
        <Icon name="plus" className="h-4 w-4" />
        <span className="max-[419px]:hidden">{label}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="panel w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">{label}</h2>
            <input
              ref={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') go()
              }}
              dir="auto"
              aria-label={ph}
              placeholder={ph}
              maxLength={120}
              className="field"
            />
            {err && (
              <p role="alert" dir="auto" className="mt-2 text-sm text-danger">
                {err}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                {cancel}
              </button>
              <button type="button" className="btn btn-primary" disabled={!name.trim() || busy} onClick={go}>
                {busy && <span className="spinner" />}
                {create}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
