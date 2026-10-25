'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      } else {
        setMsg('تم إرسال رابط التأكيد على إيميلك. افتحه وبعدها سجّل دخول.')
      }
    }
    setLoading(false)
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-3xl font-bold text-teal-400">Ryan Notes</h1>
      <p className="mb-8 text-sm text-slate-400">
        {mode === 'in' ? 'سجّل دخولك وكمّل مذاكرتك' : 'اعمل حساب جديد'}
      </p>

      <form onSubmit={submit} className="space-y-4">
        <input
          type="email"
          required
          dir="ltr"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-teal-500"
        />
        <input
          type="password"
          required
          minLength={6}
          dir="ltr"
          placeholder="Password (6+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-teal-500"
        />
        <button
          disabled={loading}
          className="w-full rounded-lg bg-teal-600 py-3 font-semibold hover:bg-teal-500 disabled:opacity-50"
        >
          {loading ? '...' : mode === 'in' ? 'دخول' : 'إنشاء حساب'}
        </button>
      </form>

      {msg && <p className="mt-4 text-sm text-amber-300">{msg}</p>}

      <button
        onClick={() => {
          setMode(mode === 'in' ? 'up' : 'in')
          setMsg(null)
        }}
        className="mt-6 text-sm text-slate-400 hover:text-teal-400"
      >
        {mode === 'in' ? 'معندكش حساب؟ سجّل' : 'عندك حساب؟ ادخل'}
      </button>
    </main>
  )
}
