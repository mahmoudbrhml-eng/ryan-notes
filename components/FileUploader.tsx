'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Icon from './Icon'

const MAX_BYTES = 50 * 1024 * 1024 // matches the bucket limit

type Labels = { drop: string; dropHint: string; uploading: string; tooBig: string }

export default function FileUploader({
  userId,
  subjectId,
  labels,
}: {
  userId: string
  subjectId: string
  labels: Labels
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<string[]>([])
  const busy = status !== null

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return
    const all = Array.from(list)
    setMsgs([])
    const supabase = createClient()
    const problems: string[] = []

    for (let i = 0; i < all.length; i++) {
      const file = all[i]
      setStatus(labels.uploading.replace('{i}', String(i + 1)).replace('{n}', String(all.length)))
      if (file.size > MAX_BYTES) {
        problems.push(`${file.name}: ${labels.tooBig}`)
        continue
      }
      const fileId = crypto.randomUUID()
      // Storage keys must be ASCII-safe; the original name is kept in the database.
      const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
      const path = `${userId}/${subjectId}/${fileId}-${safe}`

      const { error: upErr } = await supabase.storage
        .from('lecture-files')
        .upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) {
        problems.push(`${file.name}: ${upErr.message}`)
        continue
      }

      const { error: dbErr } = await supabase.from('files').insert({
        id: fileId,
        subject_id: subjectId,
        name: file.name,
        storage_path: path,
        mime: file.type || null,
        size_bytes: file.size,
      })
      if (dbErr) {
        await supabase.storage.from('lecture-files').remove([path])
        problems.push(`${file.name}: ${dbErr.message}`)
      }
    }

    setMsgs(problems)
    setStatus(null)
    if (input.current) input.current.value = ''
    router.refresh()
  }

  return (
    <div>
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          upload(e.dataTransfer.files)
        }}
        className="dropzone"
      >
        <Icon name="up" className="h-7 w-7" />
        <span>{status ?? labels.drop}</span>
        <small>{labels.dropHint}</small>
        <input
          ref={input}
          type="file"
          multiple
          disabled={busy}
          accept=".pdf,.pptx,.docx,.txt,.md,image/*,audio/*,video/*"
          className="sr-only"
          onChange={(e) => upload(e.target.files)}
        />
      </label>
      {msgs.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-red-400">
          {msgs.map((m, i) => (
            <li key={i} dir="auto">
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
