import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import ConfirmButton from '@/components/ConfirmButton'
import ExportButtons from '@/components/ExportButtons'
import FileAI from '@/components/FileAI'
import FileUploader from '@/components/FileUploader'
import GenerateSummary from '@/components/GenerateSummary'
import Icon from '@/components/Icon'
import Markdown, { tocOf } from '@/components/Markdown'
import { getI18n } from '@/lib/i18n'
import { fmtSize } from '@/lib/format'
import { kindOf } from '@/lib/filekind'
import { extractFocus } from '@/lib/focus'
import { createClient } from '@/lib/supabase/server'
import { deleteFile } from './actions'

const TABS = ['transcript', 'summary', 'quiz', 'focus'] as const
type Tab = (typeof TABS)[number]

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ f?: string; tab?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const { t } = await getI18n()
  const supabase = await createClient()

  const { data: subject } = await supabase.from('subjects').select('id, name').eq('id', id).single()
  // RLS returns nothing for someone else's subject -> 404.
  if (!subject) notFound()

  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) redirect('/login')

  const { data: files } = await supabase
    .from('files')
    .select('id, name, storage_path, mime, size_bytes, ai_status, ai_error, created_at')
    .eq('subject_id', id)
    .order('created_at', { ascending: false })
  const { data: outs } = await supabase.from('outputs').select('file_id, kind').eq('subject_id', id)

  const urls = new Map<string, string>()
  const paths = (files ?? []).map((f) => f.storage_path)
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from('lecture-files').createSignedUrls(paths, 3600)
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
    })
  }

  const withTranscript = new Set((outs ?? []).filter((o) => o.kind === 'transcript').map((o) => o.file_id))
  const listed = (files ?? []).filter((f) => withTranscript.has(f.id))
  const selId =
    sp.f && (files ?? []).some((f) => f.id === sp.f) ? sp.f : (listed[0]?.id ?? null)
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'transcript'
  const selFile = (files ?? []).find((f) => f.id === selId)

  let transcript = ''
  let summary = ''
  if (selId) {
    const { data: sel } = await supabase.from('outputs').select('kind, content').eq('file_id', selId)
    transcript = sel?.find((o) => o.kind === 'transcript')?.content ?? ''
    summary = sel?.find((o) => o.kind === 'summary')?.content ?? ''
  }
  const tabHref = (k: Tab) => `/subjects/${id}?${selId ? `f=${selId}&` : ''}tab=${k}`
  const tabLabel: Record<Tab, string> = {
    transcript: t.tabs.transcript,
    summary: t.tabs.summary,
    quiz: t.tabs.quiz,
    focus: t.tabs.focus,
  }
  const outName = (selFile?.name ?? 'lecture').replace(/\.[^.]+$/, '')

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
              <li key={f.id} className="border-b border-white/10 py-3 last:border-0">
                <div className="flex items-center gap-3">
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
                </div>
                <FileAI
                  fileId={f.id}
                  subjectId={subject.id}
                  kind={kindOf(f.name, f.mime)}
                  mime={f.mime ?? ''}
                  url={urls.get(f.storage_path) ?? ''}
                  status={f.ai_status as 'idle' | 'processing' | 'done' | 'error'}
                  hasOutput={withTranscript.has(f.id)}
                  error={f.ai_error}
                  t={t.ai}
                />
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex min-w-[300px] flex-[2_1_520px] flex-col gap-4">
          {listed.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="muted text-sm">{t.ai.pickFile}:</span>
              {listed.map((f) => (
                <Link
                  key={f.id}
                  href={`/subjects/${id}?f=${f.id}&tab=${tab}`}
                  dir="auto"
                  className={`tab inline-block max-w-[220px] truncate ${f.id === selId ? 'tab-on' : ''}`}
                >
                  {f.name.replace(/\.[^.]+$/, '')}
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-1">
            {TABS.map((k) => (
              <Link key={k} href={tabHref(k)} className={`tab inline-block ${tab === k ? 'tab-on' : ''}`}>
                {tabLabel[k]}
              </Link>
            ))}
          </div>

          {!selId && (
            <div className="glass">
              <h2 className="text-xl font-semibold">{t.outputs}</h2>
              <p className="muted mt-2 leading-7">{t.ai.needTranscript}</p>
            </div>
          )}

          {selId && tab === 'transcript' && (
            <div className="glass flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 dir="auto" className="text-xl font-semibold">{outName}</h2>
                <div className="flex items-center gap-2">
                  {selFile?.ai_status !== 'done' && <span className="chip">{t.ai.partial}</span>}
                  <ExportButtons
                    text={transcript}
                    filename={`${outName}.md`}
                    labels={{ copy: t.ai.copy, copied: t.ai.copied, download: t.ai.download }}
                  />
                </div>
              </div>
              {tocOf(transcript).length > 0 && (
                <details className="rounded-xl border border-white/10 bg-[#050d1e]/55 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">{t.ai.toc}</summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {tocOf(transcript).map((h, i) => (
                      <li key={i} className={h.level === 3 ? 'ms-4' : ''}>
                        <a href={`#${h.id}`} dir="auto" className="muted hover:text-teal-300">{h.text}</a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <Markdown>{transcript}</Markdown>
            </div>
          )}

          {selId && tab === 'summary' && (
            <div className="glass flex flex-col gap-4">
              {summary ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold">{t.tabs.summary}</h2>
                    <ExportButtons
                      text={summary}
                      filename={`${outName}-summary.md`}
                      labels={{ copy: t.ai.copy, copied: t.ai.copied, download: t.ai.download }}
                    />
                  </div>
                  <Markdown>{summary}</Markdown>
                </>
              ) : (
                <>
                  <p className="muted">{t.ai.noSummary}</p>
                  {transcript && (
                    <GenerateSummary
                      fileId={selId}
                      labels={{ summarize: t.ai.summarize, summarizing: t.ai.summarizing }}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {selId && tab === 'focus' && (
            <div className="glass flex flex-col gap-3">
              <h2 className="text-xl font-semibold">{t.tabs.focus}</h2>
              <p className="muted text-sm">{t.ai.focusHint}</p>
              {extractFocus(transcript).length === 0 && <p className="muted">{t.ai.noFocus}</p>}
              <ol className="space-y-3">
                {extractFocus(transcript).map((x, i) => (
                  <li
                    key={i}
                    dir="auto"
                    className="rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 leading-7"
                  >
                    ⭐ {x}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {selId && tab === 'quiz' && (
            <div className="glass flex flex-col items-start gap-3">
              <span className="chip">{t.soon}</span>
              <p className="muted">{t.ai.quizSoon}</p>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  )
}
