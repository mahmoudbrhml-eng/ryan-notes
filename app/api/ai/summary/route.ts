import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { summaryPrompt, continueSummaryPrompt, type NotesLang } from '@/lib/prompts'
import { cleanMarkdown, sliceText } from '@/lib/clean'
import { tracker } from '@/lib/usage'

export const maxDuration = 300

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 400)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

// A detailed booklet must be substantial relative to its source. Lighter models
// love to compress more than asked, so after the first pass we measure and, if
// the document came back thin, ask the model to continue with the missing
// sections (up to 2 extra passes). This is what keeps a big lecture from
// turning into a 3-page digest.
const minDetailed = (srcLen: number) => Math.max(6000, Math.min(30000, Math.floor(srcLen * 0.4)))

async function writeDetailed(lang: NotesLang, src: string, custom?: string, track?: (i: { keyIndex: number; model: string; ok: boolean; status: number | null; inTokens: number | null; outTokens: number | null; ms: number }) => void): Promise<string> {
  const started = Date.now()
  const left = () => 300000 - (Date.now() - started) // stay under the function cap
  let text = await generate([{ text: summaryPrompt(lang, src, 'detailed', custom) }], { max: 30000, budgetMs: 120000, track })
  text = cleanMarkdown(text)
  for (let pass = 0; pass < 2 && text.length < minDetailed(src.length); pass++) {
    if (left() < 90000) break // not enough time for another safe pass
    const more = await generate([{ text: continueSummaryPrompt(lang, text, src, custom) }], { max: 24000, budgetMs: 80000, track })
    const clean = cleanMarkdown(more)
    if (clean.length < 400) break // nothing meaningful came back: stop here
    text = `${text}\n\n${clean}`
  }
  return text
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    if (!claims?.claims?.sub) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const fileId = String(body.fileId ?? '')
    if (!UUID.test(fileId)) return fail('Invalid file')

    const { data: tr } = await supabase
      .from('outputs')
      .select('subject_id, title, content, lang')
      .eq('file_id', fileId)
      .eq('kind', 'transcript')
      .maybeSingle()
    if (!tr || !tr.content) return fail('Transcribe the file first.', 409, 'need_transcript')

    // Fail closed: if the usage check itself errors, no AI call goes out.
    const { data: used, error: usageErr } = await supabase.rpc('bump_usage', { p_feature: 'summary' })
    if (usageErr || typeof used !== 'number') return fail('Could not check the daily AI limit. Try again in a moment.', 503, 'limit_check')
    if (used > DAILY_LIMIT) return fail('Daily AI limit reached. Try again tomorrow.', 429, 'limit')
    const trk = tracker(supabase, 'summary')

    const bl = body.lang
    const lang: NotesLang = bl === 'en' || bl === 'fa' || bl === 'ar' ? bl : (['ar', 'en', 'fa'].includes(tr.lang) ? (tr.lang as NotesLang) : 'ar')
    const custom = typeof body.custom === 'string' ? body.custom.trim().slice(0, 600) : ''
    const length = body.length === 'short' ? 'short' : 'detailed'
    // Very long lectures: summarize slices first, then merge the summaries.
    // The output caps stay generous: a detailed revision document is meant to be
    // long, and a tight cap would silently truncate it mid-sentence.
    let text: string
    try {
      if (tr.content.length <= 90000) {
        if (length === 'short') text = await generate([{ text: summaryPrompt(lang, tr.content, 'short', custom) }], { max: 8000, track: trk })
        else text = await writeDetailed(lang, tr.content, custom, trk)
      } else {
        const partials: string[] = []
        for (const slice of sliceText(tr.content, 60000).slice(0, 8)) {
          partials.push(await generate([{ text: summaryPrompt(lang, slice, 'detailed', custom) }], { max: 20000, track: trk }))
        }
        const joined = partials.join('\n\n')
        if (length === 'short') text = await generate([{ text: summaryPrompt(lang, joined, 'short', custom) }], { max: 8000, track: trk })
        else text = await writeDetailed(lang, joined, custom, trk)
      }
    } catch (e) {
      // A failed generation never costs the user a call.
      after(async () => { try { await supabase.rpc('refund_usage', { p_feature: 'summary' }) } catch {} })
      throw e
    }
    text = cleanMarkdown(text)

    const { data: existing } = await supabase
      .from('outputs').select('id').eq('file_id', fileId).eq('kind', 'summary').maybeSingle()
    if (existing) await supabase.from('outputs').update({ content: text, lang: custom ? 'custom' : lang, summary_kind: length }).eq('id', existing.id)
    else
      await supabase.from('outputs').insert({
        subject_id: tr.subject_id, file_id: fileId, kind: 'summary', title: tr.title, lang: custom ? 'custom' : lang, content: text,
        summary_kind: length,
      })
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    console.error('[summary]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
