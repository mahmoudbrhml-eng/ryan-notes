import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { quizPrompt, type NotesLang, type QuizLevel } from '@/lib/prompts'
import { parseQuiz, type Q } from '@/lib/quizparse'
import { sampleText } from '@/lib/clean'
import { tracker } from '@/lib/usage'
import { notifyReady, outputUrl, siteOrigin } from '@/lib/telegram'

export const maxDuration = 300

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 400)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) return fail('Please log in again.', 401)

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

    // Fail closed: if the usage check itself errors, no AI call goes out.
    const { data: used, error: usageErr } = await supabase.rpc('bump_usage', { p_feature: 'quiz' })
    if (usageErr || typeof used !== 'number') return fail('Could not check the daily AI limit. Try again in a moment.', 503, 'limit_check')
    if (used > DAILY_LIMIT) return fail('Daily AI limit reached. Try again tomorrow.', 429, 'limit')

    let raw: string
    try {
      raw = await generate([{ text: quizPrompt(lang, sampleText(tr.content, 100000), count, level, custom) }], {
        json: true, max: 14000, track: tracker(supabase, 'quiz'),
      })
    } catch (e) {
      // A failed generation never costs the user a call.
      after(async () => { try { await supabase.rpc('refund_usage', { p_feature: 'quiz' }) } catch {} })
      throw e
    }
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
    // Tell the user's Telegram (if linked) that the quiz is ready — the quiz
    // itself is interactive, so the message links back into the site.
    after(() =>
      notifyReady(supabase, userId, 'quiz', {
        title: tr.title,
        url: outputUrl(siteOrigin(req), tr.subject_id, fileId, 'quiz'),
      })
    )
    return NextResponse.json({ ok: true, count: questions.length })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    console.error('[quiz]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
