import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { chatSystem, type ChatMode, type NotesLang } from '@/lib/prompts'
import { pickRelevant } from '@/lib/retrieve'
import { tracker } from '@/lib/usage'
import { guardQuota } from '@/lib/quota'

export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

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

    const ids = (Array.isArray(body.sourceIds) ? (body.sourceIds as unknown[]) : [])
      .map(String)
      .filter((x) => UUID.test(x))
      .slice(0, 12)
    let query = supabase.from('outputs').select('title, content').eq('subject_id', subjectId).eq('kind', 'transcript')
    if (ids.length > 0) query = query.in('file_id', ids)
    const { data: rows } = await query
    const material = (rows ?? []).filter((r) => r.content)
    if (material.length === 0) return fail('Transcribe a lecture first, then ask questions here.', 409, 'need_transcript')

    // Fail closed: if the usage check itself errors, no AI call goes out.
    // A failed generation refunds the call (see refund_usage) so users are
    // never charged for answers they did not get.
    const q = await guardQuota(supabase, 'chat')
    if (!q.ok) return fail(q.error, q.status, q.code)

    // Small material is sent whole; large material is reduced to the passages that match the question.
    const lastUser = [...hist].reverse().find((h) => h.role === 'user')
    const context = pickRelevant(
      material.map((r) => ({ title: r.title, content: r.content as string })),
      `${message} ${String(lastUser?.text ?? '')}`,
      70000
    )
    const prompt = `${chatSystem(mode, lang)}\n\nLECTURE MATERIAL:\n${context}\n\nCONVERSATION:\n${convo}\nStudent: ${message}\nTutor:`
    let reply: string
    try {
      reply = await generate([{ text: prompt }], { max: 4000, track: tracker(supabase, 'chat') })
    } catch (e) {
      after(async () => { try { await supabase.rpc('refund_usage', { p_feature: 'chat' }) } catch {} })
      throw e
    }
    return NextResponse.json({ reply: reply.trim() })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    // Never leak raw internals (Supabase/Node errors) to the client.
    console.error('[chat]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
