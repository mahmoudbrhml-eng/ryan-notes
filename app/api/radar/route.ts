import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Weakness Radar API.
//   GET  ?subject=<uuid>  -> aggregated accuracy for one subject
//                            (overall + trend, per source, weakest questions)
//   POST                  -> record one finished quiz run (one row per answer)
//
// Both doors are owner-only through RLS: the client here reads/writes with the
// user's own session, so nobody can ever see or forge another student's rows.
// This route never talks to AI and never touches Telegram — it is pure data.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

type Row = { q_text: string; correct: boolean; file_id: string | null; created_at: string }

const WEEK = 7 * 24 * 3600 * 1000

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) return fail('Please log in again.', 401)

  const subject = new URL(req.url).searchParams.get('subject') ?? ''
  if (!UUID.test(subject)) return fail('Invalid subject')

  // RLS filters to this user; the subject check just returns empty for
  // someone else's subject, which the UI shows as an empty radar.
  const [attemptsRes, filesRes] = await Promise.all([
    supabase
      .from('quiz_attempts')
      .select('q_text, correct, file_id, created_at')
      .eq('subject_id', subject)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('files').select('id, name').eq('subject_id', subject),
  ])
  if (attemptsRes.error || filesRes.error) return fail('Could not load the radar. Try again.', 503)

  const rows = (attemptsRes.data ?? []) as Row[]
  const names = new Map(((filesRes.data ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]))

  const total = rows.length
  const correct = rows.filter((r) => r.correct).length
  const weekAgo = Date.now() - WEEK
  const recentRows = rows.filter((r) => new Date(r.created_at).getTime() >= weekAgo)
  const recent = recentRows.length

  // Per source: the student sees which lecture is slipping, not just how much.
  const byFile = new Map<string, { total: number; correct: number; last: string }>()
  for (const r of rows) {
    if (!r.file_id) continue
    const b = byFile.get(r.file_id) ?? { total: 0, correct: 0, last: r.created_at }
    b.total += 1
    if (r.correct) b.correct += 1
    byFile.set(r.file_id, b)
  }
  const files = [...byFile.entries()]
    .map(([file_id, b]) => ({
      file_id,
      name: names.get(file_id) ?? '(deleted source)',
      total: b.total,
      acc: Math.round((b.correct / b.total) * 100),
      last: b.last,
    }))
    .sort((a, b) => a.acc - b.acc) // weakest first
    .slice(0, 12)

  // Weakest questions: grouped by text so retries sharpen the same entry.
  const byQ = new Map<string, { wrong: number; total: number; last: string }>()
  for (const r of rows) {
    const b = byQ.get(r.q_text) ?? { wrong: 0, total: 0, last: r.created_at }
    b.total += 1
    if (!r.correct) b.wrong += 1
    byQ.set(r.q_text, b)
  }
  const weak = [...byQ.entries()]
    .filter(([, b]) => b.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong || (a[1].last < b[1].last ? 1 : -1))
    .slice(0, 8)
    .map(([q, b]) => ({ q, wrong: b.wrong, total: b.total, last: b.last }))

  return NextResponse.json({
    ok: true,
    overall: {
      total,
      acc: total ? Math.round((correct / total) * 100) : 0,
      recent,
      recentAcc: recent ? Math.round((recentRows.filter((r) => r.correct).length / recent) * 100) : 0,
    },
    files,
    weak,
  })
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const subjectId = String(body.subjectId ?? '')
    const fileId = body.fileId == null ? '' : String(body.fileId)
    if (!UUID.test(subjectId)) return fail('Invalid subject')
    if (fileId && !UUID.test(fileId)) return fail('Invalid file')

    // Ownership checks: RLS makes other people's rows invisible, so an empty
    // answer means "not yours" — reject instead of silently dropping data.
    const { data: subj } = await supabase.from('subjects').select('id').eq('id', subjectId).maybeSingle()
    if (!subj) return fail('Subject not found.', 404)
    if (fileId) {
      const { data: f } = await supabase.from('files').select('id').eq('id', fileId).eq('subject_id', subjectId).maybeSingle()
      if (!f) return fail('File not found.', 404)
    }

    const raw = Array.isArray(body.results) ? body.results : []
    if (raw.length === 0 || raw.length > 60) return fail('Nothing to save.')
    const rows = raw
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x.q === 'string' && x.q.trim().length > 0)
      .map((x) => ({
        user_id: userId,
        subject_id: subjectId,
        file_id: fileId || null,
        q_text: String(x.q).trim().slice(0, 300),
        correct: x.correct === true,
      }))
    if (rows.length === 0) return fail('Nothing to save.')

    const { error } = await supabase.from('quiz_attempts').insert(rows)
    if (error) {
      console.error('[radar] insert failed')
      return fail('Could not save the attempt. Try again.', 503)
    }
    return NextResponse.json({ ok: true, saved: rows.length })
  } catch (e) {
    console.error('[radar]', e instanceof Error ? e.message : e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
