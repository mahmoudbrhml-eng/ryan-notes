import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { quizPrompt, type NotesLang, type QuizLevel } from '@/lib/prompts'
import { sampleText } from '@/lib/clean'

export const maxDuration = 300

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 400)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

type Q = { q: string; o: string[]; a: number; ex: string }

function parseQuiz(raw: string): Q[] {
  const clean = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = clean.indexOf('[')
  const end = clean.lastIndexOf(']')
  if (start < 0 || end < 0) return []
  let arr: unknown
  try {
    arr = JSON.parse(clean.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: Q[] = []
  for (const x of arr as Record<string, unknown>[]) {
    const o = Array.isArray(x.o) ? x.o.map((s) => String(s)) : []
    const a = Number(x.a)
    if (typeof x.q === 'string' && o.length === 4 && Number.isInteger(a) && a >= 0 && a <= 3) {
      out.push({ q: x.q, o, a, ex: typeof x.ex === 'string' ? x.ex : '' })
    }
  }
  return out
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    if (!claims?.claims?.sub) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const fileId = String(body.fileId ?? '')
    if (!UUID.test(fileId)) return fail('Invalid file')
    const bl = body.lang
    const lang: NotesLang = bl === 'en' || bl === 'fa' ? bl : 'ar'
    const custom = typeof body.custom === 'string' ? body.custom.trim().slice(0, 600) : ''
    const bv = body.level
    const level: QuizLevel = bv === 'easy' || bv === 'hard' ? bv : 'medium'
    const count = Math.min(30, Math.max(5, Math.round(Number(body.count) || 10)))

    const { data: tr } = await supabase
      .from('outputs')
      .select('subject_id, title, content')
      .eq('file_id', fileId)
      .eq('kind', 'transcript')
      .maybeSingle()
    if (!tr || !tr.content) return fail('Transcribe the file first.', 409, 'need_transcript')

    const { data: used } = await supabase.rpc('bump_usage')
    if (typeof used === 'number' && used > DAILY_LIMIT) return fail('Daily AI limit reached. Try again tomorrow.', 429, 'limit')

    const raw = await generate([{ text: quizPrompt(lang, sampleText(tr.content, 100000), count, level, custom) }], {
      json: true, max: 14000,
    })
    const questions = parseQuiz(raw)
    if (questions.length === 0) return fail('The AI returned an unreadable quiz. Press Generate again.', 502)

    const data = { questions, level, count: questions.length }
    const { data: existing } = await supabase
      .from('outputs').select('id').eq('file_id', fileId).eq('kind', 'quiz').maybeSingle()
    if (existing) await supabase.from('outputs').update({ data, lang: custom ? 'custom' : lang }).eq('id', existing.id)
    else
      await supabase.from('outputs').insert({
        subject_id: tr.subject_id, file_id: fileId, kind: 'quiz', title: tr.title, lang: custom ? 'custom' : lang, content: '', data,
      })
    return NextResponse.json({ ok: true, count: questions.length })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    return fail(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
