import { notFound } from 'next/navigation'
import AutoPrint from '@/components/AutoPrint'
import Logo from '@/components/Logo'
import Markdown, { BidiText, tocOf } from '@/components/Markdown'
import { getI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

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
  const toc = tocOf(out.content)

  return (
    <div className="doc min-h-screen" dir={rtl ? 'rtl' : 'ltr'}>
      <AutoPrint
        backHref={kind === 'merged' ? `/subjects/${id}?tab=combo&m=${sp.m}` : `/subjects/${id}?f=${sp.f}&tab=${kind}`}
        labels={{ print: t.pdf.print, hint: t.pdf.hint, back: t.pdf.back }}
      />
      <div className="doc-page">
        <section className="doc-cover">
          <Logo size={120} />
          <p style={{ color: '#0b6f69', fontWeight: 700, letterSpacing: '.04em' }}>Ryan Notes</p>
          <h1 dir={rtl ? 'rtl' : 'ltr'} style={{ fontSize: '30pt', fontWeight: 800, lineHeight: 1.25, maxWidth: '150mm' }}><BidiText text={title} /></h1>
          <p style={{ fontSize: '14pt', color: '#4b5563' }}>{kind === 'merged' ? t.tools.merged : t.tools[kind]}</p>
          <div style={{ marginTop: 24, color: '#4b5563', lineHeight: 2 }}>
            <p><b>{t.pdf.subject}:</b> <BidiText text={subject.name} /></p>
            <p><b>{t.pdf.date}:</b> {fmtDate(out.created_at, lang)}</p>
          </div>
        </section>

        {toc.length > 0 && (
          <section className="doc-toc">
            <h2 style={{ fontSize: '20pt', fontWeight: 800, color: '#0b6f69', marginBottom: 16 }}>{t.pdf.contents}</h2>
            <ul style={{ listStyle: 'none', padding: 0, lineHeight: 2.1 }}>
              {toc.map((h, i) => (
                <li key={i} style={{ paddingInlineStart: h.level === 3 ? 24 : 0, fontWeight: h.level === 2 ? 700 : 400, textAlign: rtl ? 'right' : 'left' }}>
                  <BidiText text={h.text} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <article>
          <Markdown dir={rtl ? 'rtl' : 'ltr'}>{out.content}</Markdown>
        </article>
      </div>
    </div>
  )
}
