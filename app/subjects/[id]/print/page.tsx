import { notFound } from 'next/navigation'
import { Fragment } from 'react'
import Markdown, { tocOf } from '@/components/Markdown'
import PagedDoc from '@/components/PagedDoc'
import AutoUpgrade from '@/components/AutoUpgrade'
import { getI18n } from '@/lib/i18n'
import { generate } from '@/lib/gemini'
import { createClient } from '@/lib/supabase/server'

// Same bar as the summary API: a detailed booklet must be substantial relative
// to its source. Older stored summaries (written before the dense pipeline)
// sit far below it — those get auto-upgraded when the user opens the PDF.
const minDetailed = (srcLen: number) => Math.max(6000, Math.min(30000, Math.floor(srcLen * 0.4)))

// The contents page is always in English: keep only the English part of each heading.
function englishOnly(s: string) {
  const runs = s.match(/[A-Za-z][A-Za-z0-9 ,'’\-–/&%+.:]*[A-Za-z0-9]/g)
  return runs ? runs.map((r) => r.trim()).join(' — ') : s
}

// The cover title is styled word by word (teal → blue → navy, the brand palette).
// Pure-Latin words get <bdi> so brackets/parentheses stay on the right side in RTL.
const LATIN_WORD = /^[A-Za-z0-9][A-Za-z0-9'’\-–&%+.:()]*$/
function ColoredTitle({ title }: { title: string }) {
  const words = title.split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  return (
    <>
      {words.map((w, i) => {
        const inner = LATIN_WORD.test(w) ? <bdi dir="ltr">{w}</bdi> : w
        return (
          <Fragment key={i}>
            <span className={`tw${i % 3}`}>{inner}</span>
            {i < words.length - 1 ? ' ' : null}
          </Fragment>
        )
      })}
    </>
  )
}
const cleanTopic = (s: string) =>
  s
    .replace(/[*_`#>]+/g, '')
    .replace(/^\s*(?:\d{1,2}\s*[.)-]|[٠-٩]{1,2}\s*[-.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)

// The topic of the notes is read from the notes themselves: the first main
// heading (then the first sub-heading). Only when the content has no structure
// at all does the AI name it; the file name is the last resort.
function topicFrom(md: string): string {
  const heads = tocOf(md)
  for (const lv of [2, 3]) {
    const h = heads.find((x) => x.level === lv)
    if (h) {
      const c = cleanTopic(h.text)
      if (c.length >= 3) return c
    }
  }
  return ''
}

async function aiTopic(md: string): Promise<string> {
  try {
    const r = await generate(
      [{ text: `Give ONE short title (max 8 words) naming the main topic of these study notes. Reply with the title only, in the same language as the notes.\n\n${md.slice(0, 5000)}` }],
      { light: true, max: 60, budgetMs: 15000 },
    )
    return cleanTopic(r.split('\n').filter((x) => x.trim())[0] ?? '')
  } catch {
    return ''
  }
}

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ f?: string; k?: string; m?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const kind = sp.k === 'summary' ? 'summary' : sp.k === 'merged' ? 'merged' : 'transcript'
  const supabase = await createClient()
  const { data: subject } = await supabase.from('subjects').select('name').eq('id', id).single()

  let title = ''
  let out: { content: string | null; lang: string; created_at: string; summary_kind?: string | null } | null = null
  let upgradeFileId = ''
  if (kind === 'merged') {
    if (!sp.m) notFound()
    const { data } = await supabase
      .from('outputs').select('title, content, lang, created_at').eq('id', sp.m).eq('kind', 'merged').eq('subject_id', id).maybeSingle()
    out = data
    title = cleanTopic(data?.title ?? '')
  } else {
    if (!sp.f) notFound()
    const { data: file } = await supabase.from('files').select('name').eq('id', sp.f).eq('subject_id', id).single()
    const { data } = await supabase
      .from('outputs').select('content, lang, created_at, summary_kind').eq('file_id', sp.f).eq('kind', kind).maybeSingle()
    out = data
    // A summary that is thin next to its own transcript was written by the old
    // lossy pipeline. Never touch a deliberate 'short' summary — only legacy or
    // failed detailed runs.
    if (kind === 'summary' && data?.content) {
      const { data: tr } = await supabase
        .from('outputs').select('content').eq('file_id', sp.f).eq('kind', 'transcript').maybeSingle()
      const trLen = tr?.content?.length ?? 0
      if (trLen > 3000 && (data.summary_kind ?? null) !== 'short' && data.content.length < minDetailed(trLen)) {
        upgradeFileId = sp.f
      }
    }
    const content = data?.content ?? ''
    title = topicFrom(content) || (content ? await aiTopic(content) : '') || (file?.name ?? '').replace(/\.[^.]+$/, '') || 'Notes'
  }
  if (!subject || !out?.content) notFound()

  const { t, lang } = await getI18n()
  const rtl = out.lang !== 'en'
  const kindLabel = kind === 'merged' ? 'Combined notes' : kind === 'summary' ? 'Summary' : 'Lecture notes'

  let n2 = 0
  let n3 = 0
  const items = tocOf(out.content).map((h) => {
    if (h.level === 2) {
      n3 = 0
      return { ...h, num: `${++n2}.`, label: englishOnly(h.text) }
    }
    return { ...h, num: `${n2}.${++n3}`, label: englishOnly(h.text) }
  })

  return (
    // dir must stay LTR on this wrapper: a RTL ancestor around Paged.js's render
    // container silently collapses pagination into one overflowing page per
    // section (verified: 3 pages vs 23). RTL text is handled inside by the
    // markdown container and the auto-direction of the cover title.
    <div className="doc min-h-screen bg-surface2" dir="ltr">
      <AutoUpgrade
        enabled={!!upgradeFileId}
        fileId={upgradeFileId}
        labels={{ upgrading: t.pdf.upgrading, hint: t.pdf.upgradeHint, fail: t.pdf.upgradeFail }}
      >
      <PagedDoc
        backHref={kind === 'merged' ? `/subjects/${id}?tab=combo&m=${sp.m}` : `/subjects/${id}?f=${sp.f}&tab=${kind}`}
        filename={`${title}.pdf`}
        docKind={kind}
        rtl={rtl}
        payload={{
          subjectId: id,
          kind,
          fileId: kind === 'merged' ? undefined : sp.f,
          mergedId: kind === 'merged' ? sp.m : undefined,
        }}
        labels={{
          print: t.pdf.print, hint: t.pdf.hint, back: t.pdf.back,
          building: t.pdf.building, again: t.pdf.again, save: t.pdf.save, saved: t.pdf.saved,
        }}
      >
        {/* Cover: only the styled topic, with a small brand mark to keep the attribution. */}
        <section className="doc-cover">
          <div className="cover-mark">Ryan Notes</div>
          <div className="cover-topic">
            <h1 className="doc-title"><ColoredTitle title={title} /></h1>
            <div className="cover-rule" />
          </div>
        </section>

        {items.length > 0 && (
          <section className="doc-toc">
            <h2 className="toc-title">Contents</h2>
            <p className="toc-sub">{items.length} sections · {kindLabel}</p>
            <div className="toc-underline" />
            <ol>
              {items.map((h) => (
                <li key={h.id} className={`l${h.level}`}>
                  <a className="t" href={`#${h.id}`}>
                    <span className="num">{h.num}</span>
                    {h.label}
                  </a>
                  <span className="dots" />
                  <a className="pg" href={`#${h.id}`} />
                </li>
              ))}
            </ol>
          </section>
        )}

        <article className="doc-body">
          <Markdown dir={rtl ? 'rtl' : 'ltr'}>{out.content}</Markdown>
        </article>
      </PagedDoc>
      </AutoUpgrade>
    </div>
  )
}
