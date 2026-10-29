import { notFound } from 'next/navigation'
import Logo from '@/components/Logo'
import Markdown, { BidiText, tocOf } from '@/components/Markdown'
import PagedDoc from '@/components/PagedDoc'
import { getI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

// The contents page is always in English: keep only the English part of each heading.
function englishOnly(s: string) {
  const runs = s.match(/[A-Za-z][A-Za-z0-9 ,'’\-–/&%+.:]*[A-Za-z0-9]/g)
  return runs ? runs.map((r) => r.trim()).join(' — ') : s
}

const LANG_NAME: Record<string, string> = { ar: 'Egyptian Arabic', fa: 'Formal Arabic', en: 'English' }

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
  let out: { content: string | null; lang: string; created_at: string } | null = null
  if (kind === 'merged') {
    if (!sp.m) notFound()
    const { data } = await supabase
      .from('outputs').select('title, content, lang, created_at').eq('id', sp.m).eq('kind', 'merged').eq('subject_id', id).maybeSingle()
    out = data
    title = data?.title ?? ''
  } else {
    if (!sp.f) notFound()
    const { data: file } = await supabase.from('files').select('name').eq('id', sp.f).eq('subject_id', id).single()
    const { data } = await supabase
      .from('outputs').select('content, lang, created_at').eq('file_id', sp.f).eq('kind', kind).maybeSingle()
    out = data
    title = (file?.name ?? '').replace(/\.[^.]+$/, '')
  }
  if (!subject || !title || !out?.content) notFound()

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
    <div className="doc min-h-screen bg-surface2" dir={rtl ? 'rtl' : 'ltr'}>
      <PagedDoc
        backHref={kind === 'merged' ? `/subjects/${id}?tab=combo&m=${sp.m}` : `/subjects/${id}?f=${sp.f}&tab=${kind}`}
        labels={{
          print: t.pdf.print, hint: t.pdf.hint, back: t.pdf.back,
          building: lang === 'ar' ? 'جارٍ تجهيز الـPDF…' : 'Preparing the PDF…',
        }}
      >
        <section className="doc-cover">
          <div className="cover-band">
            <Logo size={88} />
            <div className="cover-brand">Ryan Notes</div>
            <div className="cover-kind">{kindLabel}</div>
            <h1 className="doc-title"><BidiText text={title} /></h1>
          </div>
          <div className="cover-meta">
            <div><span>Subject</span><b className="doc-subject"><BidiText text={subject.name} /></b></div>
            <div><span>Date</span><b>{fmtDate(out.created_at, 'en')}</b></div>
            <div><span>Language</span><b>{LANG_NAME[out.lang] ?? 'Arabic'}</b></div>
          </div>
          <div className="cover-rule" />
          <div className="cover-foot">Study notes generated with Ryan Notes — review them against your textbooks and your doctor's guidance before exams.</div>
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
    </div>
  )
}
