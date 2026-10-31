import { notFound, redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import PdfReader from '@/components/PdfReader'
import { getI18n } from '@/lib/i18n'
import { createClient } from '@/lib/supabase/server'

// PDF reader & annotation workspace — additive route. It only READS the file
// the user already owns (files RLS applies) and hands a signed URL to the
// client reader; nothing about the subject page flow changes.
export default async function ReadPage({ params }: { params: Promise<{ file: string }> }) {
  const { file: fileId } = await params
  const { t } = await getI18n()
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) redirect('/login')

  const { data: file } = await supabase
    .from('files')
    .select('id, name, mime, subject_id, storage_path')
    .eq('id', fileId)
    .maybeSingle()
  if (!file) notFound()

  const isPdf = /pdf/i.test(file.mime ?? '') || /\.pdf$/i.test(file.name)
  if (!isPdf) redirect(`/subjects/${file.subject_id}`)

  const { data: signed } = await supabase.storage.from('lecture-files').createSignedUrl(file.storage_path, 3600)
  if (!signed?.signedUrl) notFound()

  return (
    <AppShell title={t.reader.title} back={{ href: `/subjects/${file.subject_id}`, label: t.reader.back }}>
      <main className="mx-auto w-full max-w-4xl px-3 pb-14 pt-4 sm:px-5">
        <PdfReader fileId={file.id} url={signed.signedUrl} name={file.name} t={t.reader} />
      </main>
    </AppShell>
  )
}
