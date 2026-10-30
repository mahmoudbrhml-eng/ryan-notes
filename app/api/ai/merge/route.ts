import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { mergePrompt, type NotesLang } from '@/lib/prompts'
import { cleanMarkdown, sampleText } from '@/lib/clean'
import { matchPartGroup } from '@/lib/parts'

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
    if (ids.length < 2) return fail('Select at least 2 sources.')
    const bl = body.lang
    const lang: NotesLang = bl === 'en' || bl === 'fa' ? bl : 'ar'

    const [{ data: outs }, { data: files }] = await Promise.all([
      supabase.from('outputs').select('file_id, content').eq('subject_id', subjectId).eq('kind', 'transcript').in('file_id', ids),
      supabase.from('files').select('id, name').eq('subject_id', subjectId).in('id', ids),
    ])
    const text = new Map((outs ?? []).map((o) => [o.file_id as string, (o.content as string) ?? '']))
    const name = new Map((files ?? []).map((f) => [f.id as string, f.name as string]))

    // Parts of one split file ("Lecture (1-3).mp3"…) are re-joined verbatim, in
    // order, with no AI and no truncation — their transcripts already come from
    // the real audio, so rewriting or sampling them would only lose content.
    const group = matchPartGroup(ids.map((id) => name.get(id) ?? ''))
    if (group) {
      if (ids.length > 16) return fail('Select up to 16 parts.')
      const byName = new Map((files ?? []).map((f) => [f.name as string, f.id as string]))
      const orderedIds = group.ordered.map((n) => byName.get(n)!)
      if (orderedIds.some((x) => !x)) return fail('Could not match the selected parts.', 400)
      const contents = orderedIds.map((id) => (text.get(id) ?? '').trim())
      if (contents.some((c) => !c)) {
        return fail('Transcribe all selected sources first.', 409, 'need_transcript')
      }
      const suffix = lang === 'en' ? 'Full transcript' : 'التفريغ الكامل'
      const title = `${group.base} — ${suffix}`.slice(0, 140)
      const { data: row, error } = await supabase
        .from('outputs')
        .insert({
          subject_id: subjectId, file_id: null, kind: 'merged', title, lang,
          content: contents.join('\n\n'),
          data: { parts: true, sources: orderedIds.map((id) => ({ id, name: name.get(id) })) },
        })
        .select('id')
        .single()
      if (error) return fail(error.message, 500)
      return NextResponse.json({ ok: true, id: row.id })
    }

    if (ids.length > 6) return fail('Select between 2 and 6 sources.')
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
