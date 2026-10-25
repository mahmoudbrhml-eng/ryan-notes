import LoginForm from '@/components/LoginForm'
import LangToggle from '@/components/LangToggle'
import { getI18n } from '@/lib/i18n'

export default async function LoginPage() {
  const { lang, t } = await getI18n()
  return (
    <main className="relative mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6">
      <div className="absolute end-5 top-5">
        <LangToggle lang={lang} label={t.lang} />
      </div>
      <div className="text-center">
        <div className="logo mx-auto !mb-4 !h-14 !w-14 !text-2xl">R</div>
        <h1 className="text-3xl font-bold">Ryan Notes</h1>
        <p className="muted mt-2">{t.login.tagline}</p>
      </div>
      <LoginForm t={t.login} />
    </main>
  )
}
