import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Study plan API (جدول المذاكرة). Three doors, all owner-scoped:
//   POST   {fileId}                  → schedule spaced reviews for a source (today/+3/+7)
//   POST   {title, day, subjectId?}  → add a manual task
//   PATCH  {id, done?, day?}         → tick a step off / reschedule it
//   DELETE {id}                      → remove an item
// The DB has a partial-unique index on (user, file, day) so double-tapping
// "Add to study plan" can never duplicate a review day.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })

// Spaced-repetition offsets in days (first/second/third pass).
const SPACING = [0, 3, 7]
const dayStr = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (base: string, n: number) => dayStr(new Date(Date.parse(`${base}T00:00:00Z`) + n * 86_400_000))

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // ---- mode A: spaced reviews for a transcribed source ------------------
    if (typeof body.fileId === 'string' && body.fileId) {
      const fileId = body.fileId
      if (!UUID.test(fileId)) return fail('Invalid file')
      const lang = body.lang === 'en' ? 'en' : 'ar'

      const { data: file } = await supabase
        .from('files').select('id, name, subject_id, user_id').eq('id', fileId).maybeSingle()
      if (!file || file.user_id !== userId) return fail('Invalid file', 404)

      const { data: tr } = await supabase
        .from('outputs').select('id').eq('file_id', fileId).eq('kind', 'transcript').maybeSingle()
      if (!tr) return fail('Transcribe the file first.', 409, 'need_transcript')

      // Already scheduled? Keep the original plan, report politely.
      const { data: existing } = await supabase
        .from('study_items').select('day').eq('user_id', userId).eq('file_id', fileId)
      const already = new Set((existing ?? []).map((r) => r.day))
      const today = dayStr(new Date())
      const rows = SPACING.map((n) => ({
        user_id: userId,
        subject_id: file.subject_id,
        file_id: fileId,
        title: lang === 'en' ? `Review: ${file.name}`.slice(0, 200) : `مراجعة: ${file.name}`.slice(0, 200),
        day: addDays(today, n),
        kind: 'review',
      })).filter((r) => !already.has(r.day))
      if (rows.length > 0) {
        const { error } = await supabase.from('study_items').insert(rows)
        if (error) {
          console.error('[planner] insert', error.message)
          return fail('Could not save the study plan. Try again.', 503, 'save')
        }
      }
      return NextResponse.json({ ok: true, added: rows.length })
    }

    // ---- mode B: manual task ----------------------------------------------
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
    const day = typeof body.day === 'string' && DATE.test(body.day) ? body.day : dayStr(new Date())
    if (!title) return fail('Write the task first.', 422, 'empty_title')
    if (day < addDays(dayStr(new Date()), -90) || day > addDays(dayStr(new Date()), 365))
      return fail('Pick a day within the next year.', 422, 'bad_day')
    const subjectId = typeof body.subjectId === 'string' && UUID.test(body.subjectId) ? body.subjectId : null

    const { data: inserted, error } = await supabase
      .from('study_items')
      .insert({ user_id: userId, subject_id: subjectId, title, day, kind: 'task' })
      .select('id')
      .single()
    if (error || !inserted) {
      console.error('[planner] task insert', error?.message)
      return fail('Could not save the study plan. Try again.', 503, 'save')
    }
    return NextResponse.json({ ok: true, id: inserted.id })
  } catch (e) {
    console.error('[planner]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(body.id ?? '')
    if (!UUID.test(id)) return fail('Invalid item')

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.done === 'boolean') patch.done = body.done
    if (typeof body.day === 'string' && DATE.test(body.day)) patch.day = body.day
    if (!('done' in patch) && !('day' in patch)) return fail('Nothing to update')

    const { error } = await supabase
      .from('study_items').update(patch).eq('id', id).eq('user_id', userId)
    if (error) {
      console.error('[planner] patch', error.message)
      return fail('Could not save the study plan. Try again.', 503, 'save')
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[planner]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(body.id ?? '')
    if (!UUID.test(id)) return fail('Invalid item')

    const { error } = await supabase
      .from('study_items').delete().eq('id', id).eq('user_id', userId)
    if (error) {
      console.error('[planner] delete', error.message)
      return fail('Could not save the study plan. Try again.', 503, 'save')
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[planner]', e)
    return fail('Something went wrong on our side. Try again.', 500)
  }
}
