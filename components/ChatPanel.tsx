'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import Markdown from './Markdown'
import { useSelection } from './Selection'
import type { Dict } from '@/lib/dict'

type Msg = { role: 'user' | 'ai'; text: string }
type Mode = 'explain' | 'exam' | 'clinical' | 'teach'
type NLang = 'ar' | 'en' | 'fa'

type Rec = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start(): void
  stop(): void
}
type RecCtor = new () => Rec

function recognitionCtor(): RecCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export default function ChatPanel({
  subjectId, hasSources, t, langLabels, initialMode, errors,
}: {
  subjectId: string
  hasSources: boolean
  t: Dict['chat']
  langLabels: { ar: string; en: string; fa: string }
  initialMode: Mode
  errors: Dict['errors']
}) {
  const sel = useSelection()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<Mode>(initialMode)
  const [lang, setLang] = useState<NLang>('ar')
  const [busy, setBusy] = useState(false)
  const [voice, setVoice] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceErr, setVoiceErr] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const rec = useRef<Rec | null>(null)
  const live = useRef({ msgs, mode, lang, voice, busy })
  live.current = { msgs, mode, lang, voice, busy }

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs, busy])

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel()
      rec.current?.stop()
    },
    []
  )

  const speechLang = (l: NLang) => (l === 'en' ? 'en-US' : 'ar-EG')

  function speak(text: string, done: () => void) {
    const synth = window.speechSynthesis
    if (!synth) return done()
    synth.cancel()
    const clean = text.replace(/[*#>`_~|]/g, ' ').replace(/\s+/g, ' ').trim()
    const pieces = clean.match(/[^.!?؟\n]{1,180}[.!?؟]?/g) ?? [clean]
    const code = speechLang(live.current.lang)
    const voices = synth.getVoices()
    const v = voices.find((x) => x.lang.toLowerCase().startsWith(code.slice(0, 2)))
    let i = 0
    const next = () => {
      if (i >= pieces.length) return done()
      const u = new SpeechSynthesisUtterance(pieces[i++])
      u.lang = code
      if (v) u.voice = v
      u.onend = next
      u.onerror = done
      synth.speak(u)
    }
    next()
  }

  function startListening() {
    const Ctor = recognitionCtor()
    if (!Ctor) {
      setVoiceErr(t.voice.unsupported)
      setVoice(false)
      return
    }
    setVoiceErr(null)
    window.speechSynthesis?.cancel()
    const r = new Ctor()
    r.lang = speechLang(live.current.lang)
    r.interimResults = true
    r.continuous = false
    let finalText = ''
    r.onresult = (e) => {
      let txt = ''
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript
      setInput(txt)
      if (e.results[e.results.length - 1].isFinal) finalText = txt
    }
    r.onerror = () => setListening(false)
    r.onend = () => {
      setListening(false)
      if (finalText.trim()) send(finalText)
    }
    rec.current = r
    setListening(true)
    r.start()
  }

  function stopListening() {
    rec.current?.stop()
    setListening(false)
  }

  async function send(override?: string) {
    const text = (override ?? input).trim()
    if (!text || live.current.busy) return
    const prev = live.current.msgs
    const next: Msg[] = [...prev, { role: 'user', text }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    let reply = ''
    try {
      const r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId, message: text, history: prev, mode: live.current.mode, lang: live.current.lang, sourceIds: sel.selected }),
      })
      const j = (await r.json().catch(() => null)) as { reply?: string; error?: string; code?: string } | null
      if (!r.ok || !j?.reply) throw new Error((errors as Record<string, string>)[j?.code ?? 'timeout'] ?? j?.error ?? errors.timeout)
      reply = j.reply
      setMsgs([...next, { role: 'ai', text: reply }])
    } catch (e) {
      setMsgs([...next, { role: 'ai', text: `⚠️ ${e instanceof Error ? e.message : 'Failed'}` }])
    } finally {
      setBusy(false)
    }
    if (reply && live.current.voice) speak(reply, () => live.current.voice && startListening())
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
        <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value as NLang)}
          className="field !w-auto !rounded-full !px-3 !py-1.5 !text-sm">
          <option value="ar">{langLabels.ar}</option>
          <option value="en">{langLabels.en}</option>
          <option value="fa">{langLabels.fa}</option>
        </select>
        <button
          type="button"
          aria-pressed={voice}
          className={`btn btn-sm ${voice ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => {
            if (voice) {
              setVoice(false)
              window.speechSynthesis?.cancel()
              stopListening()
            } else {
              setVoice(true)
              startListening()
            }
          }}
        >
          <Icon name="speaker" className="h-4 w-4" />
          {voice ? t.voice.off : t.voice.on}
        </button>
        {msgs.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm ms-auto" onClick={() => setMsgs([])}>{t.clear}</button>
        )}
      </div>

      <p className="muted text-xs">{sel.selected.length > 0 ? t.scopeSel.replace('{n}', String(sel.selected.length)) : t.scopeAll}</p>

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
        {busy && <div className="muted flex items-center gap-2 px-2 text-sm"><span className="spinner" />{t.thinking}</div>}
        {listening && <div className="flex items-center gap-2 px-2 text-sm text-brand"><span className="spinner" />{t.voice.listening}</div>}
        <div ref={end} />
      </div>

      {voiceErr && <p role="alert" className="text-xs text-danger">{voiceErr}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="flex items-center gap-2"
      >
        <button type="button" onClick={listening ? stopListening : startListening}
          aria-label={listening ? t.voice.stop : t.voice.mic} title={listening ? t.voice.stop : t.voice.mic}
          className={`btn btn-icon !h-11 !w-11 shrink-0 ${listening ? 'btn-primary' : 'btn-ghost'}`}>
          <Icon name={listening ? 'stop' : 'mic'} className="h-[18px] w-[18px]" />
        </button>
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
