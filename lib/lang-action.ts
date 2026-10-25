'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

export async function setLang(formData: FormData) {
  const lang = formData.get('lang') === 'ar' ? 'ar' : 'en'
  const store = await cookies()
  store.set('lang', lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  revalidatePath('/', 'layout')
}
