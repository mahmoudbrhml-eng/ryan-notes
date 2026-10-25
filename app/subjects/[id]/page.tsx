import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import ConfirmButton from '@/components/ConfirmButton'
import FileUploader from '@/components/FileUploader'
import Icon from '@/components/Icon'
import { getI18n } from '@/lib/i18n'
import { fmtSize } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import { deleteFile } from './actions'

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { t } = await getI18n()
  const supabase = await createClient()

  const { data: subject } = await supabase
    .from('subjects')
    .select('id, name')
    .eq('id', id)
    .single()
  // RLS returns nothing for someone else's subject -> 404.
  if (!subject) notFound()

  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) redirect('/login')

  const { data: files } = await supabase
    .from('files')
    .select('id, name, storage_path, size_bytes, created_at')
    .eq('subject_id', id)
    .order('created_at', { ascending: false })

  const urls = new Map<string, string>()
  const paths = (files ?? []).map((f) => f.storage_path)
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from('lecture-files').createSignedUrls(paths, 3600)
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
    })
  }

  return (
    <AppShell
      crumb={
        <>
          <Link href="/subjects" className="hover:text-teal-300">{t.back}</Link>
          {' / '}
          <span dir="auto" className="text-teal-300">{subject.name}</span>
        </>
      }
    >
      <section className="flex flex-wrap items-start gap-5">
        <aside className="glass flex min-w-[290px] flex-[1_1_320px] flex-col gap-4">
          <h2 className="text-xl font-semibold">{t.files}</h2>
          <FileUploader
            userId={userId}
            subjectId={subject.id}
            labels={{ drop: t.drop, dropHint: t.dropHint, uploading: t.uploading, tooBig: t.tooBig }}
          />
          {files?.length === 0 && <p className="muted text-sm">{t.noFiles}</p>}
          <ul>
            {files?.map((f) => (
              <li key={f.id} className="flex items-center gap-3 border-b border-white/10 py-3 last:border-0">
                <span className="tile h-10 w-10 bg-teal-400/15 text-teal-300">
                  <Icon name="file" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <a
                    href={urls.get(f.storage_path)}
                    target="_blank"
                    rel="noreferrer"
                    dir="auto"
                    className="block truncate font-medium hover:text-teal-300"
                  >
                    {f.name}
                  </a>
                  <span dir="ltr" className="muted text-xs">{fmtSize(f.size_bytes)}</span>
                </div>
                <form action={deleteFile}>
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="subjectId" value={subject.id} />
                  <ConfirmButton
                    message={t.confirmDeleteFile.replace('{name}', f.name)}
                    className="btn btn-ghost btn-sm !text-red-400"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                    <span className="sr-only">{t.del}</span>
                  </ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex min-w-[300px] flex-[2_1_520px] flex-col gap-4">
          <div className="flex flex-wrap gap-1" aria-hidden="true">
            {[t.tabs.transcript, t.tabs.summary, t.tabs.quiz, t.tabs.focus].map((x) => (
              <span key={x} className="tab opacity-50">{x}</span>
            ))}
          </div>
          <div className="glass flex flex-col items-start gap-3">
            <span className="chip">{t.soon}</span>
            <h2 className="text-xl font-semibold">{t.outputs}</h2>
            <p className="muted leading-7">{t.outputsSoon}</p>
          </div>
        </div>
      </section>
    </AppShell>
  )
}
