import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import PlannerList, { type PlanItem } from '@/components/PlannerList'
import { getI18n } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'

// "Study plan" (جدول المذاكرة) — spaced-repetition reviews + manual tasks.
// The server loads the next 3 weeks plus anything overdue; PlannerList owns
// the interactions. Rows are owner-scoped by RLS (sql/12_planner.sql).
export default async function PlannerPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  const userId = data.claims.sub

  const { lang, t } = await getI18n()

  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)
  const [{ data: rows }, { data: subjects }] = await Promise.all([
    supabase
      .from('study_items')
      .select('id, title, day, kind, done, subject_id')
      .eq('user_id', userId)
      // Done items only inside the 3-week window; anything still open shows up
      // no matter how far away (or overdue) it is.
      .or(`and(day.gte.${today},day.lte.${horizon}),done.eq.false`)
      .order('day', { ascending: true })
      .limit(400),
    supabase.from('subjects').select('id, name'),
  ])

  const names = new Map((subjects ?? []).map((s) => [s.id, s.name]))
  const items: PlanItem[] = (rows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    day: r.day,
    kind: r.kind === 'task' ? 'task' : 'review',
    done: r.done,
    subject_name: r.subject_id ? (names.get(r.subject_id) ?? null) : null,
  }))

  return (
    <AppShell title={t.study.title} back={{ href: '/subjects', label: t.ws.back }}>
      <main className="mx-auto w-full max-w-3xl px-4 pb-14 pt-5 md:px-6">
        <h1 className="mb-4 text-2xl font-bold">{t.study.title}</h1>
        <PlannerList initial={items} t={t.study} today={today} locale={lang === 'en' ? 'en-GB' : 'ar-EG'} />
      </main>
    </AppShell>
  )
}
