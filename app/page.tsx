import Link from 'next/link'
import { redirect } from 'next/navigation'
import Icon, { type IconName } from '@/components/Icon'
import LangToggle from '@/components/LangToggle'
import Logo from '@/components/Logo'
import ThemeToggle from '@/components/ThemeToggle'
import { getI18n } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'

const ICONS: IconName[] = ['cap', 'file', 'spark', 'mic']

export default async function Landing() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (data?.claims) redirect('/subjects')

  const { lang, t, theme } = await getI18n()
  const L = t.landing

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3">
          <Logo size={44} />
          <span className="text-xl font-bold">Ryan Notes</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-2">
          <LangToggle lang={lang} label={t.lang} />
          <ThemeToggle theme={theme} labels={{ system: t.theme.system, light: t.theme.light, dark: t.theme.dark }} />
          <Link href="/login" className="btn btn-ghost btn-sm">{L.login}</Link>
          <Link href="/login" className="btn btn-primary btn-sm">{L.start}</Link>
        </nav>
      </header>

      <section className="flex flex-wrap items-center gap-10">
        <div className="flex min-w-[300px] flex-1 flex-col gap-5">
          <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">
            <span className="block">{L.h1a}</span>
            <span className="block text-brand">{L.h1b}</span>
          </h1>
          <p className="muted text-lg leading-8">{L.sub}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/login" className="btn btn-primary !px-6 !py-3">{L.cta1}</Link>
            <Link href="/login" className="btn btn-ghost !px-6 !py-3">{L.cta2}</Link>
          </div>
        </div>

        <div className="panel flex min-w-[300px] flex-1 flex-col gap-3 p-6">
          <span className="chip self-start">{L.example} · Nephrotic Syndrome</span>
          <strong dir="ltr" className="text-start leading-7">Which finding is characteristic of nephrotic syndrome?</strong>
          {[
            ['Hematuria with RBC casts', false],
            ['Proteinuria > 3.5 g/day', true],
            ['Oliguria with hypertension', false],
          ].map(([text, ok]) => (
            <div key={String(text)} dir="ltr"
              className={`rounded-2xl border px-4 py-2.5 text-start ${ok ? 'border-brand bg-brand-soft' : 'border-line'}`}>
              {text}
            </div>
          ))}
          <p className="muted text-sm leading-6">{L.exWhy}</p>
        </div>
      </section>

      <section className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))' }}>
        {L.list.map((f, i) => (
          <div key={f.title} className="panel flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <span className="tile bg-brand-soft text-brand"><Icon name={ICONS[i]} /></span>
              {f.soon && <span className="chip">{t.soon}</span>}
            </div>
            <h3 className="text-lg font-semibold">{f.title}</h3>
            <p className="muted leading-7">{f.desc}</p>
          </div>
        ))}
      </section>

      <section className="panel flex flex-col items-center gap-3 px-6 py-12 text-center">
        <h2 className="text-2xl font-bold">{L.ctaTitle}</h2>
        <p className="muted">{L.ctaSub}</p>
        <Link href="/login" className="btn btn-primary mt-2 !px-6 !py-3">{L.start}</Link>
      </section>
      <footer className="muted pb-6 text-center text-xs leading-6">{L.legal}</footer>
    </main>
  )
}
