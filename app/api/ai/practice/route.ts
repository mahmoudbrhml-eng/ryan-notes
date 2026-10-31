import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { quizPrompt, type NotesLang } from '@/lib/prompts'
import { sampleText } from '@/lib/clean'
import { parseQuiz } from '@/lib/quizparse'
import { tracker } from '@/lib/usage'

// Practice generator: a fresh quiz aimed at the questions the student keeps
// missing. Nothing is persisted — the questions travel straight back to the
// Radar panel, and finishing them records new attempts like any other quiz.
//
// Usage: counts against the same daily AI pool as regular quizzes (fail-closed
// check, refunded when generation itself fails).

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
    const subjectId = String(body.subjectId ?? '')
    if (!UUID.test(subjectId)) return fail('Invalid subject')
    const bl = body.lang
    const lang: NotesLang = bl === 'en' || bl === 'fa' ? bl : 'ar'
    const count = Math.min(20, Math.max(5, Math.round(Number(body.count) || 10)))

    const { data: subj } = await supabase.from('subjects').select('id').eq('id', subjectId).maybeSingle()
    if (!subj) return fail('Subject not found.', 404)

    // The material: every transcript in the subject, each sampled so one huge
    // lecture cannot starve the others.
    const { data: trs } = await supabase
      .from('outputs')
      .select('content')
      .eq('subject_id', subjectId)
      .eq('kind', 'transcript')
      .order('created_at', { ascending: false })
      .limit(10)
    const md = (trs ?? [])
      .map((t) => sampleText(String(t.content ?? ''), 25000))
      .filter(Boolean)
      .join('\n\n---\n\n')
    if (!md) return fail('Transcribe a lecture first.', 409, 'need_transcript')

    // The weak spots: recent wrong answers, deduplicated by text, most recent
    // first — these steer the generator toward exactly what keeps tripping.
    const { data: wrongRows } = await supabase
      .from('quiz_attempts')
      .select('q_text')
      .eq('subject_id', subjectId)
      .eq('correct', false)
      .order('created_at', { ascending: false })
      .limit(80)
    const seen = new Set<string>()
    const weak: string[] = []
    for (const r of wrongRows ?? []) {
      const q = String(r.q_text ?? '').trim()
      if (!q || seen.has(q)) continue
      seen.add(q)
      weak.push(q.slice(0, 200))
      if (weak.length >= 12) break
    }
    if (weak.length === 0) return fail('No weak spots yet — finish a quiz first.', 409, 'no_data')

    // Fail closed: if the usage check itself errors, no AI call goes out.
    const { data: used, error: usageErr } = await supabase.rpc('bump_usage', { p_feature: 'quiz' })
    if (usageErr || typeof used !== 'number') return fail('Could not check the daily AI limit. Try again in a moment.', 503, 'limit_check')
    if (used > DAILY_LIMIT) return fail('Daily AI limit reached. Try again tomorrow.', 429, 'limit')

    const focus =
      `\n\nFOCUS ON WEAK SPOTS: this student answered the questions below WRONG recently. ` +
      `At least half of the ${count} questions must target the same concepts behind them — same knowledge, ` +
      `different angles — mixed with related material from the notes. Do not simply copy these questions back.\n` +
      weak.map((q, i) => `${i + 1}. ${q}`).join('\n')

    let raw: string
    try {
      raw = await generate([{ text: quizPrompt(lang, md, count, 'medium') + focus }], {
        json: true, max: 14000, track: tracker(supabase, 'quiz'),
      })
    } catch (e) {
      // A failed generation never costs the user a call.
      after(async () => { try { await supabase.rpc('refund_usage', { p_feature: 'quiz' }) } catch {} })
      throw e
    }
    const questions = parseQuiz(raw)
    if (questions.length === 0) return fail('The AI returned an unreadable quiz. Press the button again.', 502)

    return NextResponse.json({ ok: true, questions })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    console.error('[practice]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
