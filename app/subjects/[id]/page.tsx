import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import AddSources from '@/components/AddSources'
import AppShell from '@/components/AppShell'
import ConfirmButton from '@/components/ConfirmButton'
import ExportButtons from '@/components/ExportButtons'
import FileAI from '@/components/FileAI'
import GenerateSummary from '@/components/GenerateSummary'
import Icon, { type IconName } from '@/components/Icon'
import Markdown, { tocOf } from '@/components/Markdown'
import { getI18n } from '@/lib/i18n'
import { fmtDate, fmtSize } from '@/lib/format'
import { kindOf } from '@/lib/filekind'
import { extractFocus } from '@/lib/focus'
import { createClient } from '@/lib/supabase/server'
import { deleteFile } from './actions'

const TABS = ['transcript', 'summary', 'focus'] as const
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

  const withTranscript = new Set((outs ?? []).filter((o) => o.kind === 'transcript').map((o) => o.file_id))
  const firstWith = (files ?? []).find((f) => withTranscript.has(f.id))
  const selId = sp.f && (files ?? []).some((f) => f.id === sp.f) ? sp.f : (firstWith?.id ?? null)
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : 'transcript'
  const selFile = (files ?? []).find((f) => f.id === selId)
  const outName = (selFile?.name ?? '').replace(/\.[^.]+$/, '')

  let transcript = ''
  let summary = ''
  if (selId) {
    const { data: sel } = await supabase.from('outputs').select('kind, content').eq('file_id', selId)
    transcript = sel?.find((o) => o.kind === 'transcript')?.content ?? ''
    summary = sel?.find((o) => o.kind === 'summary')?.content ?? ''
  }

  const tabHref = (k: Tab) => `/subjects/${id}?${selId ? `f=${selId}&` : ''}tab=${k}`
  const pdfHref = (k: 'transcript' | 'summary') => `/subjects/${id}/print?f=${selId}&k=${k}`
  const live: { k: Tab; icon: IconName }[] = [
    { k: 'transcript', icon: 'file' },
    { k: 'summary', icon: 'sumry' },
    { k: 'focus', icon: 'star' },
  ]
  const soonTools: { label: string; icon: IconName }[] = [
    { label: t.tools.quiz, icon: 'quiz' },
    { label: t.tools.flash, icon: 'flash' },
    { label: t.tools.mind, icon: 'mind' },
    { label: t.tools.viva, icon: 'mic' },
    { label: t.tools.plan, icon: 'cal' },
  ]
  const generated = (outs ?? [])
    .filter((o) => o.file_id === selId && (o.kind === 'transcript' || o.kind === 'summary'))
    .map((o) => ({ kind: o.kind as 'transcript' | 'summary', date: fmtDate(o.created_at, lang) }))
  const exportLabels = { copy: t.ai.copy, copied: t.ai.copied, md: t.ai.download, pdf: t.pdf.pdf }
  const focusItems = tab === 'focus' ? extractFocus(transcript) : []
  const toc = tab === 'transcript' ? tocOf(transcript) : []

  return (
    <AppShell title={subject.name} back={{ href: '/subjects', label: t.ws.back }}>
      <div className="ws">
        {/* ---------- Sources ---------- */}
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
                <li key={f.id} className="source" data-active={f.id === selId}>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/subjects/${id}?f=${f.id}&tab=${tab}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
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
                  <FileAI
                    fileId={f.id}
                    subjectId={subject.id}
                    kind={kind}
                    mime={f.mime ?? ''}
                    url={urls.get(f.storage_path) ?? ''}
                    status={f.ai_status as 'idle' | 'processing' | 'done' | 'error'}
                    hasOutput={withTranscript.has(f.id)}
                    error={f.ai_error}
                    t={t.ai}
                  />
                </li>
              )
            })}
          </ul>
        </section>

        {/* ---------- Notes ---------- */}
        <section className="panel flex min-h-[420px] flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="min-w-0 truncate font-semibold">
              {t.tools[tab]}
              {selFile && <span dir="auto" className="muted font-normal"> · {outName}</span>}
            </h2>
            {tab === 'transcript' && transcript && (
              <ExportButtons text={transcript} filename={`${outName}.md`} pdfHref={pdfHref('transcript')} labels={exportLabels} />
            )}
            {tab === 'summary' && summary && (
              <ExportButtons text={summary} filename={`${outName}-summary.md`} pdfHref={pdfHref('summary')} labels={exportLabels} />
            )}
          </div>

          <div className="flex-1 px-5 py-5">
            {!selId && <p className="muted py-10 text-center">{t.ws.pickEmpty}</p>}

            {selId && tab === 'transcript' && (
              <div className="flex flex-col gap-4">
                {selFile?.ai_status !== 'done' && <span className="chip chip-warn self-start">{t.ai.partial}</span>}
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
            )}

            {selId && tab === 'summary' &&
              (summary ? (
                <Markdown>{summary}</Markdown>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="muted">{t.ai.noSummary}</p>
                  {transcript && (
                    <GenerateSummary fileId={selId} labels={{ summarize: t.ai.summarize, summarizing: t.ai.summarizing }} />
                  )}
                </div>
              ))}

            {selId && tab === 'focus' && (
              <div className="flex flex-col gap-3">
                <p className="muted text-sm">{t.ai.focusHint}</p>
                {focusItems.length === 0 && <p className="muted">{t.ai.noFocus}</p>}
                <ol className="space-y-3">
                  {focusItems.map((x, i) => (
                    <li key={i} dir="auto" className="rounded-2xl border border-warn/30 bg-warn-soft p-4 leading-7">
                      ⭐ {x}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          <div className="border-t border-line p-3">
            <div className="field flex items-center justify-between !rounded-full opacity-70">
              <span className="muted">{t.ws.ask}</span>
              <span className="chip">{t.soon}</span>
            </div>
          </div>
        </section>

        {/* ---------- Studio ---------- */}
        <aside className="panel flex flex-col gap-4 p-4">
          <h2 className="font-semibold">{t.ws.studio}</h2>
          <div className="grid grid-cols-2 gap-2">
            {live.map(({ k, icon }) => (
              <Link key={k} href={tabHref(k)} aria-current={tab === k ? 'page' : undefined} className="stile">
                <Icon name={icon} className="h-[18px] w-[18px]" />
                <span className="min-w-0 flex-1 truncate">{t.tools[k]}</span>
              </Link>
            ))}
            {soonTools.map((x) => (
              <div key={x.label} className="stile" aria-disabled="true" title={t.soon}>
                <Icon name={x.icon} className="h-[18px] w-[18px]" />
                <span className="min-w-0 flex-1 truncate">{x.label}</span>
              </div>
            ))}
          </div>

          {generated.length > 0 && (
            <div>
              <h3 className="muted mb-2 text-xs font-semibold uppercase tracking-wide">{t.ws.generated}</h3>
              <ul className="flex flex-col gap-2">
                {generated.map((g) => (
                  <li key={g.kind} className="flex items-center gap-3 rounded-2xl border border-line p-3">
                    <span className="tile !h-10 !w-10 bg-brand-soft text-brand">
                      <Icon name={g.kind === 'transcript' ? 'file' : 'sumry'} className="h-4 w-4" />
                    </span>
                    <Link href={tabHref(g.kind)} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{t.tools[g.kind]}</span>
                      <span className="muted text-xs">{g.date}</span>
                    </Link>
                    <a href={pdfHref(g.kind)} target="_blank" rel="noreferrer" aria-label={t.pdf.pdf} title={t.pdf.pdf}
                      className="btn btn-ghost btn-icon !h-8 !w-8">
                      <Icon name="download" className="h-4 w-4" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  )
}
