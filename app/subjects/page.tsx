import Link from 'next/link'
import AppShell from '@/components/AppShell'
import ConfirmButton from '@/components/ConfirmButton'
import Icon from '@/components/Icon'
import { getI18n } from '@/lib/i18n'
import { fmtSize } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { createSubject, deleteSubject } from './actions'

export default async function SubjectsPage() {
  const { t } = await getI18n()
  const supabase = await createClient()

  const { data: subjects, error } = await supabase
    .from('subjects')
    .select('id, name, created_at')
    .order('created_at', { ascending: false })
  const { data: fileRows } = await supabase.from('files').select('subject_id, size_bytes')

  const counts = new Map<string, number>()
  let bytes = 0
  fileRows?.forEach((f) => {
    counts.set(f.subject_id, (counts.get(f.subject_id) ?? 0) + 1)
    bytes += f.size_bytes ?? 0
  })

  const stats = [
    { label: t.stats.subjects, value: String(subjects?.length ?? 0), icon: 'cap' as const, c: 'bg-violet-500/20' },
    { label: t.stats.files, value: String(fileRows?.length ?? 0), icon: 'file' as const, c: 'bg-teal-400/20' },
    { label: t.stats.storage, value: fmtSize(bytes), icon: 'clock' as const, c: 'bg-blue-500/25' },
  ]

  return (
    <AppShell crumb={t.nav.home}>
      <div>
        <h1 className="text-3xl font-bold md:text-4xl">{t.welcome}</h1>
        <p className="muted mt-2 text-lg">{t.welcomeSub}</p>
      </div>

      <section className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        {stats.map((s) => (
          <div key={s.label} className="glass flex items-center justify-between gap-3">
            <div>
              <div className="muted text-sm">{s.label}</div>
              <div dir="ltr" className="mt-1 text-3xl font-bold">{s.value}</div>
            </div>
            <span className={`tile ${s.c}`}>
              <Icon name={s.icon} />
            </span>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-stretch gap-5">
        <div className="glass flex min-w-[300px] flex-[2_1_440px] flex-col gap-4">
          <h2 className="text-xl font-semibold">{t.yourSubjects}</h2>
          {error && <p className="text-sm text-red-400">{error.message}</p>}
          {subjects?.length === 0 && <p className="muted">{t.noSubjects}</p>}
          {subjects?.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#050d1e]/55 p-3.5"
            >
              <span className="tile bg-gradient-to-br from-violet-600 to-blue-600">
                <Icon name="cap" />
              </span>
              <div className="min-w-[120px] flex-1">
                <strong dir="auto">{s.name}</strong>
                <div className="muted text-sm">{t.filesCount.replace('{n}', String(counts.get(s.id) ?? 0))}</div>
              </div>
              <Link href={`/subjects/${s.id}`} className="btn btn-teal btn-sm">
                {t.open}
              </Link>
              <form action={deleteSubject}>
                <input type="hidden" name="id" value={s.id} />
                <ConfirmButton
                  message={t.confirmDeleteSubject.replace('{name}', s.name)}
                  className="btn btn-ghost btn-sm !text-red-400"
                >
                  <Icon name="trash" className="h-4 w-4" />
                  <span className="sr-only">{t.del}</span>
                </ConfirmButton>
              </form>
            </div>
          ))}
        </div>

        <div className="flex min-w-[280px] flex-[1_1_300px] flex-col gap-5">
          <form action={createSubject} className="glass flex flex-col gap-3">
            <h2 className="text-xl font-semibold">{t.addTitle}</h2>
            <input
              name="name"
              required
              maxLength={120}
              dir="auto"
              aria-label={t.addTitle}
              placeholder={t.subjectPlaceholder}
              className="field"
            />
            <button className="btn btn-teal">+ {t.addSubject}</button>
          </form>

          <div className="glass flex flex-col gap-3">
            <div>
              <h2 className="text-xl font-semibold">{t.quick.title}</h2>
              <p className="muted mt-1 text-sm">{t.quick.sub}</p>
            </div>
            <button disabled className="btn btn-blue">{t.quick.quiz} · {t.soon}</button>
            <button disabled className="btn btn-violet">{t.quick.viva} · {t.soon}</button>
            <button disabled className="btn btn-ghost">{t.quick.planner} · {t.soon}</button>
          </div>
        </div>
      </section>
    </AppShell>
  )
}
