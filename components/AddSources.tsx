'use client'

import { useEffect, useState } from 'react'
import Icon from './Icon'
import FileUploader from './FileUploader'

export default function AddSources({
  userId,
  subjectId,
  labels,
}: {
  userId: string
  subjectId: string
  labels: { add: string; close: string; drop: string; dropHint: string; uploading: string; tooBig: string }
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button type="button" className="btn btn-soft btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" className="h-4 w-4" />
        {labels.add}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={labels.add}
            className="panel w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{labels.add}</h2>
              <button type="button" className="btn btn-ghost btn-icon" aria-label={labels.close} onClick={() => setOpen(false)}>
                <Icon name="close" className="h-[18px] w-[18px]" />
              </button>
            </div>
            <FileUploader userId={userId} subjectId={subjectId} onDone={() => setOpen(false)} labels={labels} />
          </div>
        </div>
      )}
    </>
  )
}
