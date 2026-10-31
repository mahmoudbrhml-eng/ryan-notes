import type { Metadata } from 'next'
import { Inter, Cairo } from 'next/font/google'
import './globals.css'
import JobsProvider from '@/components/Jobs'
import { getI18n } from '@/lib/i18n'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const cairo = Cairo({ subsets: ['arabic', 'latin'], variable: '--font-cairo' })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ryan-notes-zeta.vercel.app'),
  title: { default: 'Ryan Notes', template: '%s · Ryan Notes' },
  description: 'Study smarter with your lectures',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang, dir, theme, t } = await getI18n()
  return (
    <html
      lang={lang}
      dir={dir}
      data-theme={theme === 'system' ? undefined : theme}
      className={`${inter.variable} ${cairo.variable}`}
    >
      <body>
        <JobsProvider labels={{ ai: t.ai, errors: t.errors }}>{children}</JobsProvider>
      </body>
    </html>
  )
}
