import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'

// Public share links: a student turns one of their own outputs (summary,
// transcript, quiz, combined notes) into a short public URL at /s/<token>.
// Content is copied server-side from the user's own `outputs` row (never
// trusted from the client), and one source keeps one stable link.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = new Set(['summary', 'transcript', 'quiz', 'combo'])
const MAX_CONTENT = 200_000
const MAX_Q = 60

type Q = { q: string; o: string[]; a: number; ex: string }

const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

function sanitizeQuestions(raw: unknown): Q[] {
  if (!Array.isArray(raw)) return []
  const out: Q[] = []
  for (const x of raw.slice(0, MAX_Q) as Record<string, unknown>[]) {
    const o = Array.isArray(x.o) ? x.o.map((s) => String(s).slice(0, 500)) : []
    const a = Number(x.a)
    if (typeof x.q === 'string' && x.q.trim() && o.length === 4 && Number.isInteger(a) && a >= 0 && a <= 3) {
      out.push({
        q: x.q.slice(0, 1000),
        o,
        a,
        ex: typeof x.ex === 'string' ? x.ex.slice(0, 2000) : '',
      })
    }
  }
  return out
}

function siteOrigin(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL
  if (env) return env.replace(/\/+$/, '')
  return new URL(req.url).origin
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const kind = String(body.kind ?? '')
    if (!KINDS.has(kind)) return fail('Invalid share kind')

    const comboId = String(body.comboId ?? '')
    const fileId = String(body.fileId ?? '')
    if (kind === 'combo' && !UUID.test(comboId)) return fail('Invalid source')
    if (kind !== 'combo' && !UUID.test(fileId)) return fail('Invalid source')

    // RLS makes sure the row belongs to the caller — anyone else's comes back null.
    const q = supabase.from('outputs').select('title, content, data, lang')
    const { data: row } =
      kind === 'combo'
        ? await q.eq('id', comboId).eq('kind', 'merged').maybeSingle()
        : await q.eq('file_id', fileId).eq('kind', kind).maybeSingle()
    if (!row) return fail('Nothing to share (create it first).', 404, 'missing')

    const questions = sanitizeQuestions((row.data as { questions?: unknown } | null)?.questions)
    const content = String(row.content ?? '').slice(0, MAX_CONTENT)
    if (questions.length === 0 && !content.trim()) return fail('This output is empty.', 409, 'empty')
    const lang = ['ar', 'en', 'fa', 'custom'].includes(String(row.lang)) ? String(row.lang) : null
    const title = String(row.title ?? '').slice(0, 200)

    // One stable link per source: reuse the token if it was shared before.
    const reuse = await supabase
      .from('shares').select('token')
      .eq('user_id', userId).eq('kind', kind)
      .eq('source_id', kind === 'combo' ? comboId : fileId)
      .limit(1).maybeSingle()
    if (reuse.data?.token) {
      return NextResponse.json({ ok: true, url: `${siteOrigin(req)}/s/${reuse.data.token}`, reused: true })
    }

    const token = randomBytes(18).toString('base64url')
    const ins = await supabase.from('shares').insert({
      token,
      user_id: userId,
      kind,
      source_id: kind === 'combo' ? comboId : fileId,
      title,
      lang,
      content,
      questions: questions.length > 0 ? questions : null,
    })
    if (ins.error) {
      console.error('[share] insert failed:', ins.error.message)
      return fail('Could not create the link. Try again.', 500)
    }
    return NextResponse.json({ ok: true, url: `${siteOrigin(req)}/s/${token}` })
  } catch (e) {
    console.error('[share]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    if (!claims?.claims?.sub) return fail('Please log in again.', 401)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const token = String(body.token ?? '')
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return fail('Invalid token')
    const del = await supabase.from('shares').delete().eq('token', token)
    if (del.error) return fail('Could not revoke the link.', 500)
    return NextResponse.json({ ok: true })
  } catch {
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
