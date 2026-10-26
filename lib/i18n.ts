import { cookies } from 'next/headers'
import { en, ar, type Dict } from './dict'

export type Lang = 'en' | 'ar'
export type Theme = 'system' | 'light' | 'dark'

export async function getI18n() {
  const jar = await cookies()
  const lang: Lang = jar.get('lang')?.value === 'ar' ? 'ar' : 'en'
  const th = jar.get('theme')?.value
  const theme: Theme = th === 'light' || th === 'dark' ? th : 'system'
  const t: Dict = lang === 'ar' ? ar : en
  const dir: 'rtl' | 'ltr' = lang === 'ar' ? 'rtl' : 'ltr'
  return { lang, t, dir, theme }
}
