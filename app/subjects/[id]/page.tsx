import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FileUploader from '@/components/FileUploader'
import ConfirmButton from '@/components/ConfirmButton'
import { deleteFile } from './actions'

function fmtSize(n: number | null) {
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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
    const { data: signed } = await supabase.storage
      .from('lecture-files')
      .createSignedUrls(paths, 3600)
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
    })
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/subjects" className="text-sm text-slate-400 hover:text-teal-400">
        ← موادي
      </Link>
      <h1 className="mt-4 mb-8 text-2xl font-bold text-teal-400">{subject.name}</h1>

      <h2 className="mb-3 text-lg font-semibold">الملفات</h2>
      <FileUploader userId={userId} subjectId={subject.id} />

      {files?.length === 0 && (
        <p className="mt-6 text-slate-400">لسه مفيش ملفات في المادة دي.</p>
      )}

      <ul className="mt-6 space-y-2">
        {files?.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3"
          >
            <div className="min-w-0 flex-1">
              <a
                href={urls.get(f.storage_path)}
                target="_blank"
                rel="noreferrer"
                dir="auto"
                className="block truncate font-medium hover:text-teal-400"
              >
                {f.name}
              </a>
              <span className="text-xs text-slate-500">{fmtSize(f.size_bytes)}</span>
            </div>
            <form action={deleteFile}>
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="subjectId" value={subject.id} />
              <ConfirmButton
                message={`مسح "${f.name}"؟`}
                className="text-sm text-slate-500 hover:text-red-400"
              >
                مسح
              </ConfirmButton>
            </form>
          </li>
        ))}
      </ul>
    </main>
  )
}
