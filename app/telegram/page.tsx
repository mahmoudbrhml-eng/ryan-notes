import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import TelegramConnect from '@/components/TelegramConnect'
import { getI18n } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'

export default async function TelegramPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')

  const { t } = await getI18n()
  return (
    <AppShell title={t.tg.title} back={{ href: '/subjects', label: t.ws.back }}>
      <main className="mx-auto w-full max-w-2xl px-4 pb-14 pt-5 md:px-6">
        <h1 className="mb-1 text-2xl font-bold">{t.tg.title}</h1>
        <TelegramConnect t={t.tg} />
      </main>
    </AppShell>
  )
}
