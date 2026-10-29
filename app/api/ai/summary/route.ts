import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { summaryPrompt, type NotesLang } from '@/lib/prompts'
import { cleanMarkdown, sliceText } from '@/lib/clean'

export const maxDuration = 300

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 400)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

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

    const { data: used } = await supabase.rpc('bump_usage')
    if (typeof used === 'number' && used > DAILY_LIMIT) return fail('Daily AI limit reached. Try again tomorrow.', 429, 'limit')

    const bl = body.lang
    const lang: NotesLang = bl === 'en' || bl === 'fa' || bl === 'ar' ? bl : (['ar', 'en', 'fa'].includes(tr.lang) ? (tr.lang as NotesLang) : 'ar')
    const length = body.length === 'short' ? 'short' : 'detailed'
    // Very long lectures: summarize slices first, then summarize the summaries.
    // The output caps stay generous: a detailed revision document is meant to be
    // long, and a tight cap would silently truncate it mid-sentence.
    let text: string
    if (tr.content.length <= 90000) {
      text = await generate([{ text: summaryPrompt(lang, tr.content, length) }], { light: true, max: 20000 })
    } else {
      const partials: string[] = []
      for (const slice of sliceText(tr.content, 60000).slice(0, 8)) {
        partials.push(await generate([{ text: summaryPrompt(lang, slice, 'detailed') }], { light: true, max: 10000 }))
      }
      text = await generate([{ text: summaryPrompt(lang, partials.join('\n\n'), length) }], { light: true, max: 20000 })
    }
    text = cleanMarkdown(text)

    const { data: existing } = await supabase
      .from('outputs').select('id').eq('file_id', fileId).eq('kind', 'summary').maybeSingle()
    if (existing) await supabase.from('outputs').update({ content: text, lang }).eq('id', existing.id)
    else
      await supabase.from('outputs').insert({
        subject_id: tr.subject_id, file_id: fileId, kind: 'summary', title: tr.title, lang, content: text,
      })
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    return fail(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
