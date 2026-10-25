'use client'

import { setLang } from '@/lib/lang-action'
import Icon from './Icon'

export default function LangToggle({ lang, label }: { lang: 'en' | 'ar'; label: string }) {
  return (
    <form action={setLang}>
      <input type="hidden" name="lang" value={lang === 'ar' ? 'en' : 'ar'} />
      <button className="btn btn-ghost btn-sm" aria-label="Language">
        <Icon name="globe" className="h-4 w-4" />
        {label}
      </button>
    </form>
  )
}
