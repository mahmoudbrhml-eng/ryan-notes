import { cookies } from 'next/headers'
import { en, ar, type Dict } from './dict'

export type Lang = 'en' | 'ar'

export async function getI18n() {
  const c = (await cookies()).get('lang')?.value
  const lang: Lang = c === 'ar' ? 'ar' : 'en'
  const t: Dict = lang === 'ar' ? ar : en
  const dir: 'rtl' | 'ltr' = lang === 'ar' ? 'rtl' : 'ltr'
  return { lang, t, dir }
}
