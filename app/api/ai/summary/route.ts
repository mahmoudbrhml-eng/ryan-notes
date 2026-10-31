import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { summaryPrompt, continueSummaryPrompt, minDetailedBooklet, type NotesLang } from '@/lib/prompts'
import { cleanMarkdown, sliceText } from '@/lib/clean'
import type { CallInfo } from '@/lib/gemini'
import { tracker } from '@/lib/usage'
import { guardQuota } from '@/lib/quota'
import { notifyReady, outputUrl, siteOrigin } from '@/lib/telegram'

export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

// A detailed booklet must be substantial relative to its source: the pipeline
// keeps appending "continue" passes until the booklet meets the shared bar
// (minDetailedBooklet) — up to 3 extra passes, time permitting. This is what
// keeps a big lecture from turning into a 3-page digest of its first pages.

async function writeDetailed(lang: NotesLang, src: string, custom?: string, track?: (i: CallInfo) => void): Promise<string> {
  const started = Date.now()
  const left = () => 300000 - (Date.now() - started) // stay under the function cap
  // A pass that returns close to its output-token cap was CUT OFF mid-lecture,
  // not finished — the char count cannot tell (30K tokens of Arabic is plenty
  // of chars), so token-capped passes force one extra continue each, even when
  // the booklet is already above the length bar.
  let cutOff = 0
  const trk = track
    ? (i: CallInfo) => { if ((i.outTokens ?? 0) >= 22_000) cutOff++; track(i) }
    : undefined
  let text = await generate([{ text: summaryPrompt(lang, src, 'detailed', custom) }], { max: 30000, budgetMs: 120000, track: trk })
  text = cleanMarkdown(text)
  for (let pass = 0; pass < 3; pass++) {
    const thin = text.length < minDetailedBooklet(src.length)
    if ((!thin && !cutOff) || left() < 90000) break // done, or not enough time for another safe pass
    const more = await generate([{ text: continueSummaryPrompt(lang, text, src, custom) }], { max: 24000, budgetMs: 80000, track: trk })
    const clean = cleanMarkdown(more)
    cutOff = 0 // consumed: one forced pass per capping event
    if (clean.length < 400) break // nothing meaningful came back: stop here
    text = `${text}\n\n${clean}`
  }
  return text
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) return fail('Please log in again.', 401)

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
    const q = await guardQuota(supabase, 'summary')
    if (!q.ok) return fail(q.error, q.status, q.code)
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
    // Tell the user's Telegram (if linked) that the summary is ready — file
    // attached, never blocking the response, never failing the request.
    after(() =>
      notifyReady(supabase, userId, 'summary', {
        title: tr.title,
        url: outputUrl(siteOrigin(req), tr.subject_id, fileId, 'summary'),
        file: { text },
      })
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    console.error('[summary]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
