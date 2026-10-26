import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import AddSources from '@/components/AddSources'
import AppShell from '@/components/AppShell'
import ChatPanel from '@/components/ChatPanel'
import ConfirmButton from '@/components/ConfirmButton'
import ExportButtons from '@/components/ExportButtons'
import Icon from '@/components/Icon'
import Markdown, { tocOf } from '@/components/Markdown'
import QuizRunner, { type Q } from '@/components/QuizRunner'
import StudioPanel, { type StudioFile, type Tab } from '@/components/StudioPanel'
import { getI18n } from '@/lib/i18n'
import { fmtDate, fmtSize } from '@/lib/format'
import { kindOf } from '@/lib/filekind'
import { extractFocus } from '@/lib/focus'
import { createClient } from '@/lib/supabase/server'
import { deleteFile } from './actions'

const TABS: readonly Tab[] = ['chat', 'transcript', 'summary', 'focus', 'quiz', 'flash']

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ f?: string; tab?: string; mode?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const { t, lang } = await getI18n()
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
  const { data: outs } = await supabase.from('outputs').select('file_id, kind, created_at').eq('subject_id', id)

  const urls = new Map<string, string>()
  const paths = (files ?? []).map((f) => f.storage_path)
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from('lecture-files').createSignedUrls(paths, 3600)
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
    })
  }

  const has = (fid: string, kind: string) => (outs ?? []).some((o) => o.file_id === fid && o.kind === kind)
  const firstWith = (files ?? []).find((f) => has(f.id, 'transcript'))
  const activeId =
    sp.f && (files ?? []).some((f) => f.id === sp.f) ? sp.f : (firstWith?.id ?? files?.[0]?.id ?? null)
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'transcript'
  const active = (files ?? []).find((f) => f.id === activeId)
  const outName = (active?.name ?? '').replace(/\.[^.]+$/, '')
  const anyTranscript = (outs ?? []).some((o) => o.kind === 'transcript')

  let transcript = ''
  let summary = ''
  let questions: Q[] = []
  if (activeId) {
    const { data: sel } = await supabase.from('outputs').select('kind, content, data').eq('file_id', activeId)
    transcript = sel?.find((o) => o.kind === 'transcript')?.content ?? ''
    summary = sel?.find((o) => o.kind === 'summary')?.content ?? ''
    questions = ((sel?.find((o) => o.kind === 'quiz')?.data as { questions?: Q[] } | null)?.questions ?? []) as Q[]
  }

  const studioFiles: StudioFile[] = (files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    kind: kindOf(f.name, f.mime),
    mime: f.mime ?? '',
    url: urls.get(f.storage_path) ?? '',
    status: f.ai_status as StudioFile['status'],
    error: f.ai_error,
    transcript: has(f.id, 'transcript'),
    summary: has(f.id, 'summary'),
    quiz: has(f.id, 'quiz'),
  }))
  const generated = (outs ?? [])
    .filter((o) => o.file_id === activeId && (o.kind === 'transcript' || o.kind === 'summary' || o.kind === 'quiz'))
    .map((o) => ({ kind: o.kind as 'transcript' | 'summary' | 'quiz', date: fmtDate(o.created_at, lang) }))

  const pdfHref = (k: 'transcript' | 'summary') => `/subjects/${id}/print?f=${activeId}&k=${k}`
  const exportLabels = { copy: t.ai.copy, copied: t.ai.copied, md: t.ai.download, pdf: t.pdf.pdf }
  const focusItems = tab === 'focus' ? extractFocus(transcript) : []
  const toc = tab === 'transcript' ? tocOf(transcript) : []
  const langLabels = { ar: t.ai.langAr, en: t.ai.langEn, fa: t.ai.langFa }

  return (
    <AppShell title={subject.name} back={{ href: '/subjects', label: t.ws.back }}>
      <div className="ws">
        {/* ---------- Sources: only the files ---------- */}
        <section className="panel flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">{t.ws.sources}</h2>
            <AddSources
              userId={userId}
              subjectId={subject.id}
              labels={{
                add: t.ws.add, close: t.ws.close, drop: t.upload.drop,
                dropHint: t.upload.hint, uploading: t.upload.uploading, tooBig: t.upload.tooBig,
              }}
            />
          </div>
          {files?.length === 0 && <p className="muted py-8 text-center text-sm">{t.ws.noSources}</p>}
          <ul className="flex flex-col gap-1">
            {files?.map((f) => {
              const kind = kindOf(f.name, f.mime)
              return (
                <li key={f.id} className="source" data-active={f.id === activeId}>
                  <div className="flex items-center gap-3">
                    <Link href={`/subjects/${id}?f=${f.id}&tab=${tab}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="tile !h-10 !w-10 bg-surface2 text-navy">
                        <Icon name={kind === 'media' ? 'audio' : 'file'} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span dir="auto" className="block truncate text-sm font-semibold">{f.name}</span>
                        <span dir="ltr" className="muted text-xs">{fmtSize(f.size_bytes)}</span>
                      </span>
                    </Link>
                    <form action={deleteFile}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="subjectId" value={subject.id} />
                      <ConfirmButton
                        message={t.ws.confirmDelFile.replace('{name}', f.name)}
                        className="btn btn-ghost btn-icon btn-danger !h-8 !w-8"
                      >
                        <Icon name="trash" className="h-4 w-4" />
                        <span className="sr-only">{t.ws.delFile}</span>
                      </ConfirmButton>
                    </form>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        {/* ---------- Notes / results ---------- */}
        <section className="panel flex min-h-[420px] flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="min-w-0 truncate font-semibold">
              {t.tools[tab]}
              {active && tab !== 'chat' && <span dir="auto" className="muted font-normal"> · {outName}</span>}
            </h2>
            {tab === 'transcript' && transcript && (
              <ExportButtons text={transcript} filename={`${outName}.md`} pdfHref={pdfHref('transcript')} labels={exportLabels} />
            )}
            {tab === 'summary' && summary && (
              <ExportButtons text={summary} filename={`${outName}-summary.md`} pdfHref={pdfHref('summary')} labels={exportLabels} />
            )}
          </div>

          <div className="flex-1 px-5 py-5">
            {tab === 'chat' && <ChatPanel key={sp.mode === 'exam' ? 'exam' : 'chat'} subjectId={subject.id} hasSources={anyTranscript} t={t.chat} langLabels={langLabels} initialMode={sp.mode === 'exam' ? 'exam' : 'explain'} />}

            {tab === 'transcript' &&
              (transcript ? (
                <div className="flex flex-col gap-4">
                  {active?.ai_status !== 'done' && <span className="chip chip-warn self-start">{t.ai.partial}</span>}
                  {toc.length > 0 && (
                    <details className="rounded-2xl border border-line bg-surface2/50 p-3">
                      <summary className="cursor-pointer text-sm font-semibold">{t.ai.toc}</summary>
                      <ul className="mt-2 space-y-1 text-sm">
                        {toc.map((h, i) => (
                          <li key={i} className={h.level === 3 ? 'ms-4' : ''}>
                            <a href={`#${h.id}`} dir="auto" className="muted hover:text-brand">{h.text}</a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <Markdown>{transcript}</Markdown>
                </div>
              ) : (
                <p className="muted py-10 text-center">{active ? t.studio.notTranscribed : t.ws.pickEmpty}</p>
              ))}

            {tab === 'summary' &&
              (summary ? <Markdown>{summary}</Markdown> : <p className="muted py-10 text-center">{t.ai.noSummary}</p>)}

            {tab === 'focus' && (
              <div className="flex flex-col gap-3">
                <p className="muted text-sm">{t.ai.focusHint}</p>
                {focusItems.length === 0 && <p className="muted">{t.ai.noFocus}</p>}
                <ol className="space-y-3">
                  {focusItems.map((x, i) => (
                    <li key={i} dir="auto" className="rounded-2xl border border-warn/30 bg-warn-soft p-4 leading-7">⭐ {x}</li>
                  ))}
                </ol>
              </div>
            )}

            {(tab === 'quiz' || tab === 'flash') &&
              (questions.length > 0 ? (
                <QuizRunner key={`${activeId}-${tab}-${questions.length}`} questions={questions} mode={tab} t={t.quiz} />
              ) : (
                <p className="muted py-10 text-center">{t.quiz.empty}</p>
              ))}
          </div>

          {tab !== 'chat' && (
            <div className="border-t border-line p-3">
              <Link href={`/subjects/${id}?${activeId ? `f=${activeId}&` : ''}tab=chat`}
                className="field flex items-center justify-between !rounded-full">
                <span className="muted">{t.chat.placeholder}</span>
                <Icon name="spark" className="muted h-[18px] w-[18px]" />
              </Link>
            </div>
          )}
        </section>

        {/* ---------- Studio ---------- */}
        <StudioPanel subjectId={subject.id} files={studioFiles} activeId={activeId} tab={tab} generated={generated} mode={sp.mode === 'exam' ? 'exam' : ''} t={t} />
      </div>
    </AppShell>
  )
}
