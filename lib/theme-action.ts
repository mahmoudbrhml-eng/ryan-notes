'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

export async function setTheme(formData: FormData) {
  const v = formData.get('theme')
  const theme = v === 'light' || v === 'dark' ? v : 'system'
  const store = await cookies()
  store.set('theme', theme, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  revalidatePath('/', 'layout')
}
