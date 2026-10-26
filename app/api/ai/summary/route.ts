import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { summaryPrompt, type NotesLang } from '@/lib/prompts'

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
    const fileId = String(body.fileId ?? '')
    if (!UUID.test(fileId)) return fail('Invalid file')

    const { data: tr } = await supabase
      .from('outputs')
      .select('subject_id, title, content, lang')
      .eq('file_id', fileId)
      .eq('kind', 'transcript')
      .maybeSingle()
    if (!tr || !tr.content) return fail('Transcribe the file first.', 409)

    const { data: used } = await supabase.rpc('bump_usage')
    if (typeof used === 'number' && used > DAILY_LIMIT) return fail('Daily AI limit reached. Try again tomorrow.', 429)

    const bl = body.lang
    const lang: NotesLang = bl === 'en' || bl === 'fa' || bl === 'ar' ? bl : (['ar', 'en', 'fa'].includes(tr.lang) ? (tr.lang as NotesLang) : 'ar')
    const length = body.length === 'short' ? 'short' : 'detailed'
    const text = await generate([{ text: summaryPrompt(lang, tr.content, length) }], { light: true, max: 8000 })

    const { data: existing } = await supabase
      .from('outputs').select('id').eq('file_id', fileId).eq('kind', 'summary').maybeSingle()
    if (existing) await supabase.from('outputs').update({ content: text.trim(), lang }).eq('id', existing.id)
    else
      await supabase.from('outputs').insert({
        subject_id: tr.subject_id, file_id: fileId, kind: 'summary', title: tr.title, lang, content: text.trim(),
      })
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status)
    return fail(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
