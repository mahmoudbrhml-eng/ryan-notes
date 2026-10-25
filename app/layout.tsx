import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Ryan Notes',
  description: 'منصة مذاكرة لطلبة الطب',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  )
}
