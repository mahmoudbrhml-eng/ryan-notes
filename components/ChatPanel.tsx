'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import Markdown from './Markdown'
import type { Dict } from '@/lib/dict'

type Msg = { role: 'user' | 'ai'; text: string }
type Mode = 'explain' | 'exam' | 'clinical' | 'teach'

export default function ChatPanel({
  subjectId,
  hasSources,
  t,
  langLabels,
  initialMode,
}: {
  subjectId: string
  initialMode: Mode
  hasSources: boolean
  t: Dict['chat']
  langLabels: { ar: string; en: string; fa: string }
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<Mode>(initialMode)
  const [lang, setLang] = useState<'ar' | 'en' | 'fa'>('ar')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs, busy])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    const next: Msg[] = [...msgs, { role: 'user', text }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      const r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId, message: text, history: msgs, mode, lang }),
      })
      const j = (await r.json().catch(() => null)) as { reply?: string; error?: string } | null
      if (!r.ok || !j?.reply) throw new Error(j?.error ?? 'The server took too long. Try again.')
      setMsgs([...next, { role: 'ai', text: j.reply }])
    } catch (e) {
      setMsgs([...next, { role: 'ai', text: `⚠️ ${e instanceof Error ? e.message : 'Failed'}` }])
    } finally {
      setBusy(false)
    }
  }

  if (!hasSources) return <p className="muted py-10 text-center">{t.noSources}</p>

  return (
    <div className="flex h-full min-h-[360px] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={t.mode} value={mode} onChange={(e) => setMode(e.target.value as Mode)}
          className="field !w-auto !rounded-full !px-3 !py-1.5 !text-sm">
          {(Object.keys(t.modes) as Mode[]).map((m) => (
            <option key={m} value={m}>{t.modes[m]}</option>
          ))}
        </select>
        <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as 'ar' | 'en' | 'fa')}
          className="field !w-auto !rounded-full !px-3 !py-1.5 !text-sm">
          <option value="ar">{langLabels.ar}</option>
          <option value="en">{langLabels.en}</option>
          <option value="fa">{langLabels.fa}</option>
        </select>
        {msgs.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm ms-auto" onClick={() => setMsgs([])}>{t.clear}</button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {msgs.length === 0 && <p className="muted py-10 text-center leading-7">{t.empty}</p>}
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} dir="auto" className="ms-auto w-fit max-w-[85%] rounded-3xl bg-brand-soft px-4 py-2.5 leading-7">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-[95%] rounded-3xl bg-surface2/60 px-4 py-2">
              <Markdown>{m.text}</Markdown>
            </div>
          )
        )}
        {busy && (
          <div className="muted flex items-center gap-2 px-2 text-sm"><span className="spinner" />{t.thinking}</div>
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="flex items-center gap-2"
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} dir="auto" placeholder={t.placeholder}
          aria-label={t.placeholder} className="field !rounded-full" />
        <button disabled={busy || !input.trim()} className="btn btn-primary btn-icon !h-11 !w-11 shrink-0" aria-label={t.send}>
          <Icon name="send" className="h-[18px] w-[18px] rtl:rotate-180" />
        </button>
      </form>
      <p className="muted text-center text-xs">{t.note}</p>
    </div>
  )
}
