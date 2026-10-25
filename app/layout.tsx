import type { Metadata } from 'next'
import { Inter, Cairo } from 'next/font/google'
import './globals.css'
import PolyBg from '@/components/PolyBg'
import { getI18n } from '@/lib/i18n'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const cairo = Cairo({ subsets: ['arabic', 'latin'], variable: '--font-cairo' })

export const metadata: Metadata = {
  title: 'Ryan Notes',
  description: 'Study smarter with your lectures',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang, dir } = await getI18n()
  return (
    <html lang={lang} dir={dir} className={`${inter.variable} ${cairo.variable}`}>
      <body>
        <PolyBg />
        {children}
      </body>
    </html>
  )
}
