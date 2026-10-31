import Link from 'next/link'
import Icon from './Icon'
import Logo from './Logo'
import LangToggle from './LangToggle'
import ThemeToggle from './ThemeToggle'
import Menu from './Menu'
import NewSubject from './NewSubject'
import { signOut } from '@/app/subjects/actions'
import { getI18n } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'

export default async function AppShell({
  title,
  back,
  children,
}: {
  title?: string
  back?: { href: string; label: string }
  children: React.ReactNode
}) {
  const { lang, t, theme } = await getI18n()
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const email = (data?.claims as { email?: string } | undefined)?.email ?? ''
  const initial = (email[0] ?? 'R').toUpperCase()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-[76px] items-center gap-3 bg-bg/90 px-4 backdrop-blur md:px-6">
        {back && (
          <Link href={back.href} className="btn btn-ghost btn-icon" aria-label={back.label} title={back.label}>
            <Icon name="back" className="h-[18px] w-[18px] rtl:rotate-180" />
          </Link>
        )}
        <Link href="/subjects" className="flex items-center gap-3">
          <Logo size={40} />
          {!title && <span className="hidden text-lg font-bold sm:block">Ryan Notes</span>}
        </Link>
        {title && (
          <h1 dir="auto" className="min-w-0 flex-1 truncate text-lg font-semibold md:text-xl">
            {title}
          </h1>
        )}
        {!title && <div className="flex-1" />}
        <Link href="/tools" className="btn btn-ghost btn-sm" title={t.pdft.short} aria-label={t.pdft.short}>
          <Icon name="wrench" className="h-4 w-4" />
          <span className="hidden md:inline">{t.pdft.short}</span>
        </Link>
        <NewSubject label={t.home.newSubject} ph={t.home.namePh} create={t.home.create} cancel={t.home.cancel} />
        <LangToggle lang={lang} label={t.lang} />
        <ThemeToggle theme={theme} labels={{ system: t.theme.system, light: t.theme.light, dark: t.theme.dark }} />
        <Menu
          label={email || 'Account'}
          trigger={initial}
          className="grid h-10 w-10 cursor-pointer place-items-center rounded-full bg-brand-soft font-bold text-brand"
          panelClassName="w-64"
        >
          <p dir="ltr" className="muted truncate px-2 pb-2 text-sm">{email}</p>
          <form action={signOut}>
            <button className="menu-item">
              <Icon name="out" className="h-4 w-4" />
              {t.signOut}
            </button>
          </form>
        </Menu>
      </header>
      {children}
    </div>
  )
}
