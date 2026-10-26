'use client'

import { useState } from 'react'

export default function ExportButtons({
  text,
  filename,
  labels,
}: {
  text: string
  filename: string
  labels: { copy: string; copied: string; download: string }
}) {
  const [ok, setOk] = useState(false)
  return (
    <div className="flex gap-2">
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
        {labels.download}
      </button>
    </div>
  )
}
