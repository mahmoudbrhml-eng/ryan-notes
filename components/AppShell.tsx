import Link from 'next/link'
import Icon, { type IconName } from './Icon'
import LangToggle from './LangToggle'
import { signOut } from '@/app/subjects/actions'
import { getI18n } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'

export default async function AppShell({
  crumb,
  children,
}: {
  crumb: React.ReactNode
  children: React.ReactNode
}) {
  const { lang, t } = await getI18n()
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const email = (data?.claims as { email?: string } | undefined)?.email ?? ''
  const initial = (email[0] ?? 'R').toUpperCase()

  const soon: { icon: IconName; label: string }[] = [
    { icon: 'spark', label: t.nav.tutor },
    { icon: 'mic', label: t.nav.viva },
    { icon: 'cal', label: t.nav.planner },
    { icon: 'chart', label: t.nav.progress },
  ]

  return (
    <div className="flex min-h-screen">
      <nav className="sbar" aria-label="Main">
        <Link href="/subjects" className="logo" aria-label="Ryan Notes">
          R
        </Link>
        <Link href="/subjects" className="nv nv-act" aria-label={t.nav.home} aria-current="page">
          <Icon name="home" />
        </Link>
        {soon.map((s) => (
          <span key={s.label} className="nv opacity-45" title={`${s.label} · ${t.soon}`} aria-disabled="true">
            <Icon name={s.icon} />
          </span>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4 md:px-9">
          <div>
            <strong className="text-xl">Ryan Notes</strong>
            <div className="muted text-sm">{crumb}</div>
          </div>
          <div className="flex items-center gap-3">
            <LangToggle lang={lang} label={t.lang} />
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#1E3A6E] font-bold" title={email}>
              {initial}
            </span>
            <form action={signOut}>
              <button className="btn btn-ghost btn-sm" aria-label={t.signOut} title={t.signOut}>
                <Icon name="out" className="h-4 w-4" />
              </button>
            </form>
          </div>
        </header>
        <main className="flex flex-col gap-7 px-6 py-7 md:px-9">{children}</main>
      </div>
    </div>
  )
}
