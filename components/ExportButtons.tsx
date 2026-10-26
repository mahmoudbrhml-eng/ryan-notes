'use client'

import { useState } from 'react'
import Icon from './Icon'

export default function ExportButtons({
  text,
  filename,
  pdfHref,
  labels,
}: {
  text: string
  filename: string
  pdfHref: string
  labels: { copy: string; copied: string; md: string; pdf: string }
}) {
  const [ok, setOk] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={pdfHref} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
        <Icon name="download" className="h-4 w-4" />
        {labels.pdf}
      </a>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setOk(true)
            setTimeout(() => setOk(false), 1500)
          } catch {}
        }}
      >
        {ok ? labels.copied : labels.copy}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
          const a = document.createElement('a')
          a.href = url
          a.download = filename
          a.click()
          URL.revokeObjectURL(url)
        }}
      >
        {labels.md}
      </button>
    </div>
  )
}
