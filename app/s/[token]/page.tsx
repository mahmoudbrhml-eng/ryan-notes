import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Icon from '@/components/Icon'
import Logo from '@/components/Logo'
import Markdown from '@/components/Markdown'
import QuizRunner, { type Q } from '@/components/QuizRunner'
import { getI18n } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

// The public storefront: /s/<token> opens WITHOUT an account. Whoever receives
// the link on WhatsApp/Telegram sees the shared content, beautifully branded,
// with a signup CTA right below it — marketing that travels before the site.

export const dynamic = 'force-dynamic'

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/

type ShareRow = {
  kind: string
  title: string
  lang: string | null
  content: string
  questions: Q[] | null
  views: number
  created_at: string
}

const loadShare = cache(async (token: string): Promise<ShareRow | null> => {
  if (!TOKEN.test(token)) return null
  const supabase = await createClient()
  const { data } = await supabase.rpc('public_share', { p_token: token }).maybeSingle()
  return (data as unknown as ShareRow) ?? null
})

const stripMd = (s: string) =>
  s.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|\-]+/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim()

const cleanQuestions = (raw: unknown): Q[] => {
  if (!Array.isArray(raw)) return []
  const out: Q[] = []
  for (const x of raw as Record<string, unknown>[]) {
    const o = Array.isArray(x.o) ? x.o.map((s) => String(s)) : []
    const a = Number(x.a)
    if (typeof x.q === 'string' && o.length === 4 && Number.isInteger(a) && a >= 0 && a <= 3) {
      out.push({ q: x.q, o, a, ex: typeof x.ex === 'string' ? x.ex : '' })
    }
  }
  return out
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const share = await loadShare(token)
  if (!share) return { title: 'Ryan Notes' }
  const questions = cleanQuestions(share.questions)
  const desc =
    questions.length > 0
      ? questions[0].q.slice(0, 180)
      : stripMd(share.content).slice(0, 180) || 'Shared notes on Ryan Notes'
  return {
    title: share.title || 'Ryan Notes',
    description: desc,
    openGraph: {
      title: share.title || 'Ryan Notes',
      description: desc,
      images: ['/og.png'],
      type: 'article',
    },
    twitter: { card: 'summary_large_image', title: share.title || 'Ryan Notes', description: desc, images: ['/og.png'] },
  }
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const share = await loadShare(token)
  if (!share) notFound()

  // One view per open. Cheap update, runs on the fresh dynamic render.
  {
    const supabase = await createClient()
    void supabase.rpc('share_seen', { p_token: token })
  }

  const { t, dir } = await getI18n()
  const questions = cleanQuestions(share.questions)
  const isQuiz = questions.length > 0
  const contentDir: 'rtl' | 'ltr' = share.lang === 'en' ? 'ltr' : 'rtl'
  const kindLabel =
    share.kind === 'quiz' ? t.tools.quiz : share.kind === 'summary' ? t.tools.summary : share.kind === 'combo' ? t.tools.merged : t.tools.transcript

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-[64px] items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:px-6">
        <Link href="/" className="flex items-center gap-3">
          <Logo size={36} />
          <span className="hidden text-base font-bold sm:block">Ryan Notes</span>
        </Link>
        <span className="chip ms-auto">{t.pub.madeBy}</span>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pb-16 pt-6">
        <div className="flex flex-col gap-2">
          <h1 dir="auto" className="break-words text-2xl font-extrabold leading-snug md:text-3xl">
            {share.title || kindLabel}
          </h1>
          <div className="muted flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="chip">{kindLabel}</span>
            <span>{fmtDate(share.created_at, dir === 'rtl' ? 'ar' : 'en')}</span>
            <span className="inline-flex items-center gap-1.5" dir="ltr">
              <Icon name="eye" className="h-4 w-4" />
              {t.pub.views.replace('{n}', String(share.views ?? 0))}
            </span>
          </div>
        </div>

        <article className="panel p-5 md:p-7">
          {isQuiz ? (
            <div className="flex flex-col gap-4">
              <p className="muted text-sm">{t.pub.quizHint}</p>
              <QuizRunner questions={questions} mode="quiz" t={t.quiz} rtl={dir === 'rtl'} />
            </div>
          ) : share.content.trim() ? (
            <div className="read-md">
              <Markdown dir={contentDir}>{share.content}</Markdown>
            </div>
          ) : (
            <p className="muted py-10 text-center">{t.pub.notesHint}</p>
          )}
        </article>

        {/* The funnel: the receiver is one tap away from their own account */}
        <section className="relative overflow-hidden rounded-3xl bg-brand-soft p-6 text-center md:p-8">
          <h2 dir="auto" className="text-xl font-extrabold text-brand md:text-2xl">
            {t.pub.ctaTitle}
          </h2>
          <p dir="auto" className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
            {t.pub.ctaSub}
          </p>
          <Link href="/" className="btn btn-primary mt-4 inline-flex items-center gap-2 !px-6 !text-base">
            <Icon name="spark" className="h-5 w-5" />
            {t.pub.ctaBtn}
          </Link>
        </section>

        <p dir="auto" className="muted text-center text-xs">
          {t.pub.legal}
        </p>
      </main>
    </div>
  )
}
