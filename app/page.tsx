import Link from 'next/link'
import { redirect } from 'next/navigation'
import Icon, { type IconName } from '@/components/Icon'
import LangToggle from '@/components/LangToggle'
import { getI18n } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'

const ICONS: IconName[] = ['cap', 'file', 'spark', 'mic']

export default async function Landing() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (data?.claims) redirect('/subjects')

  const { lang, t } = await getI18n()
  const L = t.landing

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-2xl font-bold text-teal-300">Ryan Notes</span>
        <nav className="flex flex-wrap items-center gap-3">
          <LangToggle lang={lang} label={t.lang} />
          <Link href="/login" className="btn btn-ghost btn-sm">{L.login}</Link>
          <Link href="/login" className="btn btn-teal btn-sm">{L.start}</Link>
        </nav>
      </header>

      <section className="flex flex-wrap items-center gap-10">
        <div className="flex min-w-[300px] flex-1 flex-col gap-5">
          <h1 className="text-4xl font-bold leading-tight md:text-5xl">
            <span className="block">{L.h1a}</span>
            <span className="block text-teal-300">{L.h1b}</span>
          </h1>
          <p className="muted text-lg leading-8">{L.sub}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/login" className="btn btn-teal">{L.cta1}</Link>
            <Link href="/login" className="btn btn-ghost">{L.cta2}</Link>
          </div>
        </div>

        <div className="glass flex min-w-[300px] flex-1 flex-col gap-3">
          <span className="chip self-start">{L.example} · Nephrotic Syndrome</span>
          <strong dir="ltr" className="text-start leading-7">
            Which finding is characteristic of nephrotic syndrome?
          </strong>
          {[
            ['Hematuria with RBC casts', false],
            ['Proteinuria > 3.5 g/day', true],
            ['Oliguria with hypertension', false],
          ].map(([text, ok]) => (
            <div
              key={String(text)}
              dir="ltr"
              className={`rounded-lg border px-4 py-2.5 text-start ${
                ok ? 'border-teal-400 bg-teal-400/15' : 'border-white/20'
              }`}
            >
              {text}
            </div>
          ))}
          <p className="muted text-sm leading-6">{L.exWhy}</p>
        </div>
      </section>

      <section className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))' }}>
        {L.list.map((f, i) => (
          <div key={f.title} className="glass flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="tile bg-teal-400/15 text-teal-300">
                <Icon name={ICONS[i]} />
              </span>
              {f.soon && <span className="chip">{L.soon}</span>}
            </div>
            <h3 className="text-lg font-semibold">{f.title}</h3>
            <p className="muted leading-7">{f.desc}</p>
          </div>
        ))}
      </section>

      <section className="glass flex flex-col items-center gap-3 py-10 text-center">
        <h2 className="text-2xl font-bold">{L.ctaTitle}</h2>
        <p className="muted">{L.ctaSub}</p>
        <Link href="/login" className="btn btn-teal mt-2">{L.start}</Link>
      </section>
    </main>
  )
}
