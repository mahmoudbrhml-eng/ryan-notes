'use client'

import { setTheme } from '@/lib/theme-action'
import Icon from './Icon'

type Theme = 'system' | 'light' | 'dark'
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const ICON = { system: 'auto', light: 'sun', dark: 'moon' } as const

export default function ThemeToggle({ theme, labels }: { theme: Theme; labels: Record<Theme, string> }) {
  return (
    <form action={setTheme}>
      <input type="hidden" name="theme" value={NEXT[theme]} />
      <button className="btn btn-ghost btn-icon" aria-label={labels[theme]} title={labels[theme]}>
        <Icon name={ICON[theme]} className="h-[18px] w-[18px]" />
      </button>
    </form>
  )
}
