import LoginForm from '@/components/LoginForm'
import LangToggle from '@/components/LangToggle'
import Logo from '@/components/Logo'
import ThemeToggle from '@/components/ThemeToggle'
import { getI18n } from '@/lib/i18n'

export default async function LoginPage() {
  const { lang, t, theme } = await getI18n()
  return (
    <main className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="absolute end-5 top-5 flex items-center gap-2">
        <LangToggle lang={lang} label={t.lang} />
        <ThemeToggle theme={theme} labels={{ system: t.theme.system, light: t.theme.light, dark: t.theme.dark }} />
      </div>
      <div className="text-center">
        <div className="mx-auto mb-4 w-fit"><Logo size={72} /></div>
        <h1 className="text-3xl font-bold">Ryan Notes</h1>
        <p className="muted mt-2">{t.login.tagline}</p>
      </div>
      <LoginForm t={t.login} />
    </main>
  )
}
