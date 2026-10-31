'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Icon from './Icon'
import type { Dict } from '@/lib/dict'

type Row = { chat_id: string | null; chat_title: string | null; linked_at: string | null }
type State = 'loading' | 'off' | 'idle' | 'linking' | 'linked' | 'error'

// One panel, three states: not linked -> waiting for START -> linked.
// While waiting we poll the user's own row (RLS) every 3s for up to 3 minutes,
// so the moment the user presses START the page flips to "linked" by itself.
export default function TelegramConnect({ t }: { t: Dict['tg'] }) {
  const [state, setState] = useState<State>('loading')
  const [row, setRow] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const poll = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (poll.current) {
      clearInterval(poll.current)
      poll.current = null
    }
  }, [])

  const readRow = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('telegram_links')
      .select('chat_id, chat_title, linked_at')
      .limit(1)
    if (error) return null
    return (data?.[0] as Row | undefined) ?? null
  }, [])

  useEffect(() => {
    let alive = true
    readRow().then((r) => {
      if (!alive) return
      if (r?.chat_id) {
        setRow(r)
        setState('linked')
      } else setState('idle')
    })
    return () => {
      alive = false
      stopPolling()
    }
  }, [readRow, stopPolling])

  const connect = async () => {
    setBusy(true)
    setState((s) => (s === 'off' ? 'off' : s))
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' })
      if (res.status === 503) {
        setState('off')
        return
      }
      if (!res.ok) {
        setState('error')
        return
      }
      const { url } = (await res.json()) as { url: string }
      window.open(url, '_blank', 'noopener')
      setState('linking')
      let tries = 0
      stopPolling()
      poll.current = setInterval(async () => {
        tries += 1
        const r = await readRow()
        if (r?.chat_id) {
          stopPolling()
          setRow(r)
          setState('linked')
        } else if (tries > 60) {
          stopPolling()
          setState((s) => (s === 'linking' ? 'idle' : s))
        }
      }, 3000)
    } catch {
      setState('error')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      const supabase = createClient()
      await supabase.from('telegram_links').delete()
      setRow(null)
      setState('idle')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="muted">{t.sub}</p>

      <div className="panel p-5">
        {state === 'loading' && <p className="muted">…</p>}

        {state === 'off' && (
          <p className="muted">
            <Icon name="close" className="me-1 inline h-4 w-4 align-[-2px]" /> {t.off}
          </p>
        )}

        {state === 'error' && <p className="muted">{t.err}</p>}

        {(state === 'idle' || state === 'linking') && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="chip chip-warn">{t.notLinked}</span>
            </div>
            {state === 'linking' ? (
              <p className="font-medium">{t.connecting}</p>
            ) : (
              <button className="btn btn-primary" onClick={connect} disabled={busy}>
                <Icon name="send" className="h-4 w-4" />
                {t.connect}
              </button>
            )}
          </div>
        )}

        {state === 'linked' && row && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip">
                <Icon name="check" className="me-1 inline h-3 w-3 align-[-1px]" /> {t.linked}
              </span>
              {row.chat_title && (
                <span className="muted text-sm">
                  {t.linkedAs}: <b dir="auto">{row.chat_title}</b>
                </span>
              )}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={disconnect} disabled={busy}>
              {t.disconnect}
            </button>
          </div>
        )}
      </div>

      <div className="panel p-5">
        <h2 className="mb-2 font-bold">{t.get}</h2>
        <ul className="space-y-2">
          {[t.get1, t.get2, t.get3].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Icon name="check" className="mt-1 h-4 w-4 shrink-0 text-brand" />
              <span className="text-sm">{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="muted text-sm">{t.privacy}</p>
    </div>
  )
}
