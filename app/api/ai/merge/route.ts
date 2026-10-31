import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, generate } from '@/lib/gemini'
import { mergePrompt, quizPrompt, summaryPrompt, continueSummaryPrompt, minDetailedBooklet, type NotesLang, type QuizLevel } from '@/lib/prompts'
import { cleanMarkdown, sampleText } from '@/lib/clean'
import type { CallInfo } from '@/lib/gemini'
import { matchPartGroup } from '@/lib/parts'
import { tracker } from '@/lib/usage'
import { guardQuota } from '@/lib/quota'

export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

type Q = { q: string; o: string[]; a: number; ex: string }

function parseQuiz(raw: string): Q[] {
  const clean = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = clean.indexOf('[')
  const end = clean.lastIndexOf(']')
  if (start < 0 || end < 0) return []
  let arr: unknown
  try {
    arr = JSON.parse(clean.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: Q[] = []
  for (const x of arr as Record<string, unknown>[]) {
    const o = Array.isArray(x.o) ? x.o.map((s) => String(s)) : []
    const a = Number(x.a)
    if (typeof x.q === 'string' && o.length === 4 && Number.isInteger(a) && a >= 0 && a <= 3) {
      out.push({ q: x.q, o, a, ex: typeof x.ex === 'string' ? x.ex : '' })
    }
  }
  return out
}

// One detailed pass plus continuation passes — the merged transcript can be
// long, so the same density guarantee as the per-source summary applies
// (shared minDetailedBooklet, token-capped passes force one extra continue,
// and a time guard keeps the whole chain inside the function cap).

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
    const custom = typeof body.custom === 'string' ? body.custom.trim().slice(0, 600) : ''
    const job = body.job === 'summary' || body.job === 'quiz' ? (body.job as 'summary' | 'quiz') : 'notes'
    const length = body.length === 'short' ? 'short' : 'detailed'
    const level: QuizLevel = body.level === 'easy' || body.level === 'hard' ? body.level : 'medium'
    const count = Math.min(30, Math.max(5, Math.round(Number(body.count) || 10)))

    const [{ data: outs }, { data: files }] = await Promise.all([
      supabase.from('outputs').select('file_id, content').eq('subject_id', subjectId).eq('kind', 'transcript').in('file_id', ids),
      supabase.from('files').select('id, name').eq('subject_id', subjectId).in('id', ids),
    ])
    const text = new Map((outs ?? []).map((o) => [o.file_id as string, (o.content as string) ?? '']))
    const name = new Map((files ?? []).map((f) => [f.id as string, f.name as string]))

    // Parts of one split recording ("Urology round instruments (1-3).mp3"…)
    // are re-joined verbatim, in order, with no AI and no truncation — their
    // transcripts already come from the real audio, so rewriting or sampling
    // them would only lose content. Legacy rows still arrive as separate
    // records with the "(i-n)" naming convention.
    const group = matchPartGroup(ids.map((id) => name.get(id) ?? ''))
    let joined = ''
    let sourceList: { id: string; name: string }[] = []
    if (group) {
      if (ids.length > 16) return fail('Select up to 16 parts.')
      const byName = new Map((files ?? []).map((f) => [f.name as string, f.id as string]))
      const orderedIds = group.ordered.map((n) => byName.get(n)!).filter((x) => !!x)
      if (orderedIds.length !== ids.length) return fail('Could not match the selected parts.', 400)
      const contents = orderedIds.map((id) => (text.get(id) ?? '').trim())
      if (contents.some((c) => !c)) return fail('Transcribe all selected sources first.', 409, 'need_transcript')
      joined = contents.join('\n\n')
      sourceList = orderedIds.map((id) => ({ id, name: name.get(id) ?? '' }))
    } else {
      if (ids.length > 6) return fail('Select between 2 and 6 sources.')
      sourceList = ids.filter((id) => name.has(id)).map((id) => ({ id, name: name.get(id) as string }))
      const contents = sourceList.map((s) => ({ ...s, t: text.get(s.id) ?? '' }))
      if (contents.length < 2 || contents.some((s) => !s.t)) {
        return fail('Transcribe all selected sources first.', 409, 'need_transcript')
      }
      joined = contents.map((s) => `## ${s.name.replace(/\.[^.]+$/, '')}\n\n${s.t}`).join('\n\n')
    }
    const pretty = (n: string) => n.replace(/\.[^.]+$/, '').replace(/[_#]+/g, ' ').trim()
    const baseTitle = sourceList.map((s) => pretty(s.name)).join(' + ').slice(0, 120)

    // The verbatim notes join needs no AI at all: skip the usage counter for it.
    // Fail closed: if the usage check itself errors, no AI call goes out.
    const verbatimNotes = job === 'notes' && !!group
    let mergeTrk: ReturnType<typeof tracker> | undefined
    if (!verbatimNotes) {
      const q = await guardQuota(supabase, 'merge')
      if (!q.ok) return fail(q.error, q.status, q.code)
      mergeTrk = tracker(supabase, 'merge')
    }

    const insertMerged = async (title: string, content: string, data: Record<string, unknown>) => {
      const { data: row, error } = await supabase
        .from('outputs')
        .insert({
          subject_id: subjectId, file_id: null, kind: 'merged', title: title.slice(0, 140),
          lang: custom ? 'custom' : lang, content, data: { ...data, sources: sourceList },
        })
        .select('id')
        .single()
      if (error) {
        console.error('[merge] insert failed:', error.message)
        return fail('Could not save the combined result. Try again.', 500)
      }
      return NextResponse.json({ ok: true, id: row.id })
    }

    // Every AI path below refunds the daily counter when generation fails.
    const refund = () => after(async () => { try { await supabase.rpc('refund_usage', { p_feature: 'merge' }) } catch {} })

    // ---- one combined summary from all selected transcripts ----
    if (job === 'summary') {
      let out: string
      try {
        if (length === 'short') {
          out = cleanMarkdown(await generate([{ text: summaryPrompt(lang, joined, 'short', custom) }], { max: 8000, track: mergeTrk }))
        } else {
          const t0 = Date.now()
          const left = () => 300000 - (Date.now() - t0)
          let cutOff = 0
          const trk = (i: CallInfo) => { if ((i.outTokens ?? 0) >= 22_000) cutOff++; mergeTrk?.(i) }
          let t = cleanMarkdown(await generate([{ text: summaryPrompt(lang, joined, 'detailed', custom) }], { max: 30000, budgetMs: 120000, track: trk }))
          for (let pass = 0; pass < 3; pass++) {
            const thin = t.length < minDetailedBooklet(joined.length)
            if ((!thin && !cutOff) || left() < 90000) break
            const more = await generate([{ text: continueSummaryPrompt(lang, t, joined, custom) }], { max: 24000, budgetMs: 80000, track: trk })
            const clean = cleanMarkdown(more)
            cutOff = 0
            if (clean.length < 400) break
            t = `${t}\n\n${clean}`
          }
          out = t
        }
      } catch (e) {
        refund()
        throw e
      }
      const title = out.match(/^#{1,2} (.+)$/m)?.[1] ?? `${baseTitle} — Summary`
      return await insertMerged(title, out, { job: 'summary', length })
    }

    // ---- one combined quiz from all selected transcripts ----
    if (job === 'quiz') {
      let raw: string
      try {
        raw = await generate([{ text: quizPrompt(lang, sampleText(joined, 100000), count, level, custom) }], {
          json: true, max: 14000, track: mergeTrk,
        })
      } catch (e) {
        refund()
        throw e
      }
      const questions = parseQuiz(raw)
      if (questions.length === 0) return fail('The AI returned an unreadable quiz. Try again.', 502)
      const title = `${baseTitle} — Quiz`
      return await insertMerged(title, '', { job: 'quiz', questions, level, count: questions.length })
    }

    // ---- combined notes (the original behaviour) ----
    if (group) {
      const suffix = custom
        ? 'Combined transcript'
        : lang === 'en'
          ? 'Full transcript'
          : 'التفريغ الكامل'
      const title = `${group.base} — ${suffix}`
      return await insertMerged(title, joined, { parts: true })
    }

    let raw: string
    try {
      raw = await generate(
        [{ text: mergePrompt(lang, sourceList.map((s) => ({ name: s.name, text: sampleText(text.get(s.id) ?? '', 60000) })), custom) }],
        { max: 16000, track: mergeTrk }
      )
    } catch (e) {
      refund()
      throw e
    }
    const content = cleanMarkdown(raw)
    const title = content.match(/^#{1,2} (.+)$/m)?.[1] ?? baseTitle
    return await insertMerged(title, content, {})
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    console.error('[merge]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
