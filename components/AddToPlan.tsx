'use client'

import { useState } from 'react'
import Icon from './Icon'
import { postJson } from '@/lib/client-api'

// "Add to study plan" — schedules three spaced reviews (today, +3, +7) for a
// transcribed source with ONE tap. Sits in the source overview next to the
// reader/open buttons; turns into a quiet confirmation afterwards.
export default function AddToPlan({ fileId, lang, label, added, err }: {
  fileId: string
  lang: 'ar' | 'en'
  label: string
  added: string
  err: string
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle')

  async function add() {
    setState('busy')
    try {
      await postJson('/api/planner', { fileId, lang })
      setState('ok')
    } catch {
      setState('fail')
    }
  }

  if (state === 'ok')
    return (
      <span className="btn btn-soft btn-sm w-fit cursor-default" aria-live="polite">
        <Icon name="check" className="h-4 w-4" />
        {added}
      </span>
    )

  return (
    <span className="flex flex-col gap-1">
      <button type="button" onClick={add} disabled={state === 'busy'} className="btn btn-soft btn-sm w-fit">
        {state === 'busy' && <span className="spinner" />}
        <Icon name="cal" className="h-4 w-4" />
        {state === 'fail' ? err : label}
      </button>
    </span>
  )
}
