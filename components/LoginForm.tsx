'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Icon from './Icon'
import type { Dict } from '@/lib/dict'

export default function LoginForm({ t }: { t: Dict['login'] }) {
  const router = useRouter()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMsg(null)
    const supabase = createClient()

    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMsg(error.message)
      else {
        router.replace('/subjects')
        router.refresh()
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      })
      if (error) setMsg(error.message)
      else if (data.session) {
        router.replace('/subjects')
        router.refresh()
      } else setMsg(t.checkEmail)
    }
    setLoading(false)
  }

  return (
    <div className="glass w-full max-w-sm space-y-5 p-7">
      <div className="flex gap-1" role="tablist">
        {(['in', 'up'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m)
              setMsg(null)
            }}
            className={`tab ${mode === m ? 'tab-on' : ''}`}
          >
            {m === 'in' ? t.tabIn : t.tabUp}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm">
            {t.email}
          </label>
          <input
            id="email"
            type="email"
            required
            dir="ltr"
            autoComplete="email"
            placeholder="name@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm">
            {t.password}
          </label>
          <div className="relative">
            <input
              id="password"
              type={show ? 'text' : 'password'}
              required
              minLength={6}
              dir="ltr"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field pe-12"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? t.hide : t.show}
              aria-pressed={show}
              className="absolute inset-y-0 end-0 flex w-12 items-center justify-center text-slate-400 hover:text-teal-300"
            >
              <Icon name={show ? 'eyeoff' : 'eye'} />
            </button>
          </div>
        </div>
        <button disabled={loading} className="btn btn-teal w-full">
          {loading ? '…' : mode === 'in' ? t.submitIn : t.submitUp}
        </button>
      </form>

      {msg && (
        <p role="alert" className="text-sm text-amber-300">
          {msg}
        </p>
      )}
      <p className="muted text-center text-sm">{t.privacy}</p>
    </div>
  )
}
