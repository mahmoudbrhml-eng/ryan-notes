import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { mergePrompt, type NotesLang } from '@/lib/prompts'
import { cleanMarkdown, sampleText } from '@/lib/clean'

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
    const subjectId = String(body.subjectId ?? '')
    if (!UUID.test(subjectId)) return fail('Invalid subject')
    const ids = (Array.isArray(body.fileIds) ? (body.fileIds as unknown[]) : []).map(String).filter((x) => UUID.test(x))
    if (ids.length < 2 || ids.length > 6) return fail('Select between 2 and 6 sources.')
    const bl = body.lang
    const lang: NotesLang = bl === 'en' || bl === 'fa' ? bl : 'ar'

    const [{ data: outs }, { data: files }] = await Promise.all([
      supabase.from('outputs').select('file_id, content').eq('subject_id', subjectId).eq('kind', 'transcript').in('file_id', ids),
      supabase.from('files').select('id, name').eq('subject_id', subjectId).in('id', ids),
    ])
    const text = new Map((outs ?? []).map((o) => [o.file_id as string, (o.content as string) ?? '']))
    const name = new Map((files ?? []).map((f) => [f.id as string, f.name as string]))
    const sources = ids
      .filter((id) => name.has(id))
      .map((id) => ({ id, name: name.get(id) as string, text: text.get(id) ?? '' }))
    if (sources.length < 2 || sources.some((s) => !s.text)) {
      return fail('Transcribe all selected sources first.', 409, 'need_transcript')
    }

    const { data: used } = await supabase.rpc('bump_usage')
    if (typeof used === 'number' && used > DAILY_LIMIT) return fail('Daily AI limit reached. Try again tomorrow.', 429, 'limit')

    const raw = await generate(
      [{ text: mergePrompt(lang, sources.map((s) => ({ name: s.name, text: sampleText(s.text, 60000) }))) }],
      { max: 16000 }
    )
    const content = cleanMarkdown(raw)
    const title = (content.match(/^#{1,2} (.+)$/m)?.[1] ?? sources.map((s) => s.name.replace(/\.[^.]+$/, '')).join(' + ')).slice(0, 140)

    const { data: row, error } = await supabase
      .from('outputs')
      .insert({
        subject_id: subjectId, file_id: null, kind: 'merged', title, lang, content,
        data: { sources: sources.map((s) => ({ id: s.id, name: s.name })) },
      })
      .select('id')
      .single()
    if (error) return fail(error.message, 500)
    return NextResponse.json({ ok: true, id: row.id })
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    return fail(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
