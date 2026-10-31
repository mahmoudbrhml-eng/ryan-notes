import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import ChatPanel from '@/components/ChatPanel'
import ExportButtons from '@/components/ExportButtons'
import Icon, { type IconName } from '@/components/Icon'
import Markdown, { tocOf } from '@/components/Markdown'
import PanelSwipe from '@/components/PanelSwipe'
import QuickAdd from '@/components/QuickAdd'
import QuizRunner, { type Q } from '@/components/QuizRunner'
import Radar from '@/components/Radar'
import ReadControls from '@/components/ReadControls'
import ShareButton from '@/components/ShareButton'
import SourcesPanel, { type SrcFile } from '@/components/SourcesPanel'
import { SelectionProvider } from '@/components/Selection'
import StudioPanel, { type StudioFile, type Tab } from '@/components/StudioPanel'
import WsGrid from '@/components/WsGrid'
import { getI18n } from '@/lib/i18n'
import { fmtDate, fmtSize } from '@/lib/format'
import { kindOf } from '@/lib/filekind'
import { extractFocus } from '@/lib/focus'
import { createClient } from '@/lib/supabase/server'

const TABS: readonly Tab[] = ['overview', 'chat', 'transcript', 'summary', 'focus', 'quiz', 'flash', 'radar', 'combo']
type Panel = 'sources' | 'notes' | 'studio'

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ f?: string; tab?: string; mode?: string; p?: string; m?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const { t, lang } = await getI18n()
  const supabase = await createClient()

  // One round of parallel queries instead of a waterfall.
  const [subjectRes, claimsRes, filesRes, outsRes] = await Promise.all([
    supabase.from('subjects').select('id, name').eq('id', id).single(),
    supabase.auth.getClaims(),
    supabase
      .from('files')
      .select('id, name, storage_path, mime, size_bytes, ai_status, ai_error, source_url, created_at')
      .eq('subject_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('outputs').select('id, file_id, kind, title, created_at').eq('subject_id', id),
  ])
  const subject = subjectRes.data
  // RLS returns nothing for someone else's subject -> 404.
  if (!subject) notFound()
  const userId = claimsRes.data?.claims?.sub
  if (!userId) redirect('/login')

  const files = filesRes.data ?? []
  const outs = outsRes.data ?? []
  const combos = outs.filter((o) => o.kind === 'merged').sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const comboId = sp.m ?? combos[0]?.id ?? null
  const has = (fid: string, kind: string) => outs.some((o) => o.file_id === fid && o.kind === kind)
  const firstWith = files.find((f) => has(f.id, 'transcript'))
  const activeId = sp.f && files.some((f) => f.id === sp.f) ? sp.f : (firstWith?.id ?? files[0]?.id ?? null)
  const active = files.find((f) => f.id === activeId) ?? null
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as Tab)
    : active ? 'overview' : 'chat'
  const panel: Panel =
    sp.p === 'sources' || sp.p === 'notes' || sp.p === 'studio' ? sp.p : files.length > 0 ? 'notes' : 'sources'

  const [signedRes, selRes, comboRes] = await Promise.all([
    active && !active.source_url
      ? supabase.storage.from('lecture-files').createSignedUrl(active.storage_path, 3600)
      : Promise.resolve(null),
    activeId ? supabase.from('outputs').select('kind, content, data, lang').eq('file_id', activeId) : Promise.resolve(null),
    tab === 'combo' && comboId
      ? supabase.from('outputs').select('id, title, content, lang, data').eq('id', comboId).eq('kind', 'merged').maybeSingle()
      : Promise.resolve(null),
  ])
  const activeUrl = signedRes?.data?.signedUrl ?? ''
  const sel = selRes?.data ?? []
  const transcript = sel.find((o) => o.kind === 'transcript')?.content ?? ''
  const summary = sel.find((o) => o.kind === 'summary')?.content ?? ''
  const questions = ((sel.find((o) => o.kind === 'quiz')?.data as { questions?: Q[] } | null)?.questions ?? []) as Q[]

  const dirOf = (l?: string | null) => (l === 'en' ? 'ltr' : 'rtl') as 'ltr' | 'rtl'
  const tLang = sel.find((o) => o.kind === 'transcript')?.lang as string | undefined
  const sLang = sel.find((o) => o.kind === 'summary')?.lang as string | undefined
  const combo = comboRes?.data ?? null
  const comboQuiz = ((combo?.data as { questions?: Q[] } | null)?.questions ?? []) as Q[]
  const outName = (active?.name ?? '').replace(/\.[^.]+$/, '')
  const anyTranscript = outs.some((o) => o.kind === 'transcript')
  const href = (k: Tab, p: string) => `/subjects/${id}?${activeId ? `f=${activeId}&` : ''}tab=${k}&p=${p}`
  const swipeBase = `/subjects/${id}?${activeId ? `f=${activeId}&` : ''}tab=${tab}`
  const pdfHref = (k: 'transcript' | 'summary') => `/subjects/${id}/print?f=${activeId}&k=${k}`
  const exportLabels = { copy: t.ai.copy, copied: t.ai.copied, md: t.ai.download, pdf: t.pdf.pdf }
  const langLabels = { ar: t.ai.langAr, en: t.ai.langEn, fa: t.ai.langFa }
  const focusItems = tab === 'focus' || tab === 'overview' ? extractFocus(transcript) : []
  const toc = tab === 'transcript' ? tocOf(transcript) : []

  const srcFiles: SrcFile[] = files.map((f) => {
    const kind = kindOf(f.name, f.mime)
    const yt = f.mime === 'video/youtube'
    return {
      id: f.id,
      name: f.name,
      sub: yt ? 'YouTube' : f.source_url ? hostOf(f.source_url) : fmtSize(f.size_bytes),
      icon: (yt ? 'play' : f.source_url ? 'link' : kind === 'media' ? 'audio' : f.mime === 'text/plain' ? 'text' : 'file') as IconName,
    }
  })
  const studioFiles: StudioFile[] = files.map((f) => ({
    id: f.id,
    name: f.name,
    kind: kindOf(f.name, f.mime),
    mime: f.mime ?? '',
    url: f.id === activeId ? activeUrl : '',
    path: f.storage_path,
    isLink: !!f.source_url,
    status: f.ai_status as StudioFile['status'],
    error: f.ai_error,
    transcript: has(f.id, 'transcript'),
    summary: has(f.id, 'summary'),
    quiz: has(f.id, 'quiz'),
  }))
  const generated = outs
    .filter((o) => o.file_id === activeId && (o.kind === 'transcript' || o.kind === 'summary' || o.kind === 'quiz'))
    .map((o) => ({ kind: o.kind as 'transcript' | 'summary' | 'quiz', date: fmtDate(o.created_at, lang) }))

  const cards: { tab: Tab; icon: IconName; label: string; ready: boolean }[] = [
    { tab: 'transcript', icon: 'file', label: t.tools.transcript, ready: !!transcript },
    { tab: 'summary', icon: 'sumry', label: t.tools.summary, ready: !!summary },
    { tab: 'focus', icon: 'star', label: t.tools.focus, ready: focusItems.length > 0 },
    { tab: 'quiz', icon: 'quiz', label: t.tools.quiz, ready: questions.length > 0 },
    { tab: 'flash', icon: 'flash', label: t.tools.flash, ready: questions.length > 0 },
  ]
  const title = tab === 'overview' ? t.ws.overview : tab === 'combo' ? t.tools.merged : t.tools[tab]
  const isVideo = (active?.mime ?? '').startsWith('video/') && active?.mime !== 'video/youtube'
  const isAudio = (active?.mime ?? '').startsWith('audio/')

  // The deliverable itself (everything except the AI chat): rendered in the
  // wide middle panel and, on phones, again inside the Studio panel so
  // opening a result never kicks you out of the Studio.
  const readContent = (
    <>
            {tab === 'overview' &&
              (active ? (
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-3">
                    <h3 dir="auto" className="break-words text-xl font-semibold">{active.name}</h3>
                    <p dir="ltr" className="muted text-sm">{srcFiles.find((s) => s.id === active.id)?.sub}</p>
                    {isAudio && activeUrl && <audio controls src={activeUrl} className="w-full" />}
                    {isVideo && activeUrl && <video controls src={activeUrl} className="w-full rounded-2xl" />}
                    {active.mime === 'video/youtube' && active.source_url && (
                      <a href={active.source_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm w-fit">
                        {t.ws.openVideo}
                      </a>
                    )}
                    {!active.source_url && !isAudio && !isVideo && activeUrl && (
                      <a href={activeUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm w-fit">
                        {t.ws.openFile}
                      </a>
                    )}
                  </div>
                  <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))' }}>
                    {cards.map((c) => (
                      <div key={c.tab} className="flex flex-col gap-3 rounded-2xl bg-surface2 p-4">
                        <div className="flex items-center gap-3">
                          <span className="tile !h-10 !w-10 bg-brand-soft text-brand"><Icon name={c.icon} className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1 truncate font-semibold">{c.label}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`chip ${c.ready ? '' : 'chip-warn'}`}>{c.ready ? t.ws.ready : t.ws.notYet}</span>
                          <Link
                            scroll={false}
                            href={c.ready ? href(c.tab, 'notes') : href(c.tab === 'focus' ? 'transcript' : c.tab, 'studio')}
                            className={`btn btn-sm ${c.ready ? 'btn-soft' : 'btn-ghost'}`}
                          >
                            {c.ready ? t.ws.open : t.ws.create}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="muted py-10 text-center">{t.ws.noSources}</p>
              ))}

            {tab === 'chat' && (
              <ChatPanel
                key={sp.mode === 'exam' ? 'exam' : 'chat'}
                subjectId={subject.id}
                hasSources={anyTranscript}
                t={t.chat}
                langLabels={langLabels}
                initialMode={sp.mode === 'exam' ? 'exam' : 'explain'}
                errors={t.errors}
              />
            )}

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
                  <Markdown dir={dirOf(tLang)}>{transcript}</Markdown>
                </div>
              ) : (
                <p className="muted py-10 text-center">{active ? t.studio.notTranscribed : t.ws.pickEmpty}</p>
              ))}

            {tab === 'summary' &&
              (summary ? <Markdown dir={dirOf(sLang)}>{summary}</Markdown> : <p className="muted py-10 text-center">{t.ai.noSummary}</p>)}

            {tab === 'combo' &&
              (comboQuiz.length > 0 ? (
                <QuizRunner key={`combo-${combo?.id}-${comboQuiz.length}`} questions={comboQuiz} mode="quiz" t={t.quiz} rtl={lang !== 'en'} />
              ) : combo?.content ? (
                <Markdown dir={dirOf(combo.lang as string)}>{combo.content as string}</Markdown>
              ) : (
                <p className="muted py-10 text-center">{t.ws.combos}</p>
              ))}

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
                <QuizRunner
                  key={`${activeId}-${tab}-${questions.length}`}
                  questions={questions}
                  mode={tab}
                  t={t.quiz}
                  rtl={lang !== 'en'}
                  track={tab === 'quiz' && activeId ? { subjectId: subject.id, fileId: activeId } : undefined}
                />
              ) : (
                <p className="muted py-10 text-center">{t.quiz.empty}</p>
              ))}

            {tab === 'radar' && <Radar subjectId={subject.id} t={t.radar} quizT={t.quiz} rtl={lang !== 'en'} />}
    </>
  )

  const panelBtn = (p: Panel, label: string, icon: IconName) => (
    <Link
      key={p}
      scroll={false}
      href={`/subjects/${id}?${activeId ? `f=${activeId}&` : ''}tab=${tab}&p=${p}`}
      aria-current={panel === p ? 'page' : undefined}
      className="text-muted flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-semibold aria-[current=page]:text-brand"
    >
      <Icon name={icon} className="h-5 w-5" />
      {label}
    </Link>
  )

  return (
    <AppShell title={subject.name} back={{ href: '/subjects', label: t.ws.back }}>
      <SelectionProvider>
      <PanelSwipe current={panel} base={swipeBase} labels={{ next: t.ws.nextPanel, prev: t.ws.prevPanel }}>
      <WsGrid>
        <SourcesPanel
          subjectId={subject.id}
          userId={userId}
          files={srcFiles}
          activeId={activeId}
          hideOnMobile={panel !== 'sources'}
          t={t}
        />

        {/* ---------- Notes / results ---------- */}
        <section className={`panel flex min-h-[420px] flex-col ${panel !== 'notes' ? 'max-[1099px]:hidden' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="min-w-0 truncate font-semibold">
              {title}
              {active && tab !== 'chat' && tab !== 'overview' && (
                <span dir="auto" className="muted font-normal"> · {outName}</span>
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {/* add a new note from inside the reading view — no panel switch, no going back */}
              <QuickAdd subjectId={subject.id} userId={userId} t={t} />
              {tab !== 'chat' && tab !== 'overview' && <ReadControls labels={t.read} />}
              {tab === 'transcript' && transcript && (
                <ExportButtons text={transcript} filename={`${outName}.md`} pdfHref={pdfHref('transcript')} labels={exportLabels} />
              )}
              {tab === 'summary' && summary && (
                <ExportButtons text={summary} filename={`${outName}-summary.md`} pdfHref={pdfHref('summary')} labels={exportLabels} />
              )}
              {tab === 'combo' && combo?.content && (
                <ExportButtons
                  text={combo.content as string}
                  filename={`${String(combo.title).slice(0, 60)}.md`}
                  pdfHref={`/subjects/${id}/print?k=merged&m=${combo.id}`}
                  labels={exportLabels}
                />
              )}
              {/* Public share link: the content travels to WhatsApp/Telegram
                  before anyone even opens the site — the growth loop. */}
              {tab === 'transcript' && transcript && (
                <ShareButton kind="transcript" fileId={activeId ?? undefined} shareTitle={`${subject.name} · ${outName}`} labels={t.share} />
              )}
              {tab === 'summary' && summary && (
                <ShareButton kind="summary" fileId={activeId ?? undefined} shareTitle={`${subject.name} · ${outName}`} labels={t.share} />
              )}
              {(tab === 'quiz' || tab === 'flash') && questions.length > 0 && (
                <ShareButton kind="quiz" fileId={activeId ?? undefined} shareTitle={`${subject.name} · ${outName}`} labels={t.share} />
              )}
              {tab === 'combo' && combo && (
                <ShareButton kind="combo" comboId={combo.id} shareTitle={`${subject.name} · ${String(combo.title ?? outName)}`} labels={t.share} />
              )}
            </div>
          </div>

          <div className="read-md flex-1 px-5 py-5">
            {tab === 'chat' ? (
              <ChatPanel
                key={sp.mode === 'exam' ? 'exam' : 'chat'}
                subjectId={subject.id}
                hasSources={anyTranscript}
                t={t.chat}
                langLabels={langLabels}
                initialMode={sp.mode === 'exam' ? 'exam' : 'explain'}
                errors={t.errors}
              />
            ) : (
              readContent
            )}
          </div>

          {tab !== 'chat' && (
            <div className="border-t border-line p-3">
              <Link scroll={false} href={href('chat', 'notes')} className="field flex items-center justify-between !rounded-full">
                <span className="muted">{t.chat.placeholder}</span>
                <Icon name="spark" className="muted h-[18px] w-[18px]" />
              </Link>
            </div>
          )}
        </section>

        <StudioPanel
          subjectId={subject.id}
          files={studioFiles}
          activeId={activeId}
          tab={tab}
          generated={generated}
          combos={combos.map((c) => ({ id: c.id, title: c.title, date: fmtDate(c.created_at, lang) }))}
          activeCombo={comboId}
          hideOnMobile={panel !== 'studio'}
          t={t}
        >
          {tab !== 'chat' && tab !== 'overview' && <div className="read-md px-5 py-5">{readContent}</div>}
        </StudioPanel>
        </WsGrid>
      </PanelSwipe>
      </SelectionProvider>

      <nav aria-label="Panels" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] min-[1100px]:hidden">
        {panelBtn('sources', t.ws.sources, 'file')}
        {panelBtn('notes', t.ws.notes, 'sumry')}
        {panelBtn('studio', t.ws.studio, 'spark')}
      </nav>
    </AppShell>
  )
}
