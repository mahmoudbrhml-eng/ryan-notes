import Link from 'next/link'
import Logo from '@/components/Logo'
import { getI18n } from '@/lib/i18n'

export default async function NotFound() {
  const { lang } = await getI18n()
  const ar = lang === 'ar'
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <Logo size={64} />
      <h1 className="text-4xl font-extrabold">404</h1>
      <p className="muted">{ar ? 'الصفحة دي مش موجودة أو مش بتاعتك.' : 'This page does not exist, or it is not yours.'}</p>
      <Link href="/subjects" className="btn btn-primary">{ar ? 'ارجع للمواد' : 'Back to subjects'}</Link>
    </main>
  )
}
