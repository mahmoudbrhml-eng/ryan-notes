import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import PdfTools from '@/components/tools/PdfTools'
import { getI18n } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'

export default async function ToolsPage() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')

  const { t } = await getI18n()
  return (
    <AppShell title={t.pdft.title}>
      <main className="px-4 pb-14 pt-5 md:px-6">
        <PdfTools t={t.pdft} />
      </main>
    </AppShell>
  )
}
