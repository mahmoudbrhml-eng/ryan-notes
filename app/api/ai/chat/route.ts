import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { chatSystem, type ChatMode, type NotesLang } from '@/lib/prompts'

export const maxDuration = 60

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 150)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    if (!claims?.claims?.sub) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const subjectId = String(body.subjectId ?? '')
    if (!UUID.test(subjectId)) return fail('Invalid subject')
    const message = String(body.message ?? '').trim().slice(0, 2000)
    if (!message) return fail('Empty message')
    const bm = body.mode
    const mode: ChatMode = bm === 'exam' || bm === 'clinical' || bm === 'teach' ? bm : 'explain'
    const bl = body.lang
    const lang: NotesLang = bl === 'en' || bl === 'fa' ? bl : 'ar'

    const hist = Array.isArray(body.history) ? (body.history as Record<string, unknown>[]).slice(-8) : []
    const convo = hist
      .map((h) => `${h.role === 'user' ? 'Student' : 'Tutor'}: ${String(h.text ?? '').slice(0, 3000)}`)
      .join('\n')

    const { data: rows } = await supabase
      .from('outputs')
      .select('title, content')
      .eq('subject_id', subjectId)
      .eq('kind', 'transcript')
    const material = (rows ?? []).filter((r) => r.content)
    if (material.length === 0) return fail('Transcribe a lecture first, then ask questions here.', 409)

    const { data: used } = await supabase.rpc('bump_usage')
    if (typeof used === 'number' && used > DAILY_LIMIT) return fail('Daily AI limit reached. Try again tomorrow.', 429)

    const context = material.map((r) => `### Lecture: ${r.title}\n${r.content}`).join('\n\n').slice(0, 400000)
    const prompt = `${chatSystem(mode, lang)}\n\nLECTURE MATERIAL:\n${context}\n\nCONVERSATION:\n${convo}\nStudent: ${message}\nTutor:`
    const reply = await generate([{ text: prompt }], { max: 4000 })
    return NextResponse.json({ reply: reply.trim() })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status)
    return fail(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
