import AppShell from '@/components/AppShell'
import SubjectsBrowser from '@/components/SubjectsBrowser'
import { getI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

export default async function SubjectsPage() {
  const { t, lang } = await getI18n()
  const supabase = await createClient()

  const { data: subjects } = await supabase
    .from('subjects')
    .select('id, name, created_at')
    .order('created_at', { ascending: false })
  const { data: fileRows } = await supabase.from('files').select('subject_id')

  const counts = new Map<string, number>()
  fileRows?.forEach((f) => counts.set(f.subject_id, (counts.get(f.subject_id) ?? 0) + 1))

  const items = (subjects ?? []).map((s, i) => ({
    id: s.id,
    name: s.name,
    files: counts.get(s.id) ?? 0,
    date: fmtDate(s.created_at, lang),
    tint: i % 6,
  }))

  return (
    <AppShell>
      <SubjectsBrowser items={items} t={t.home} />
    </AppShell>
  )
}
