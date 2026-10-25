'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const MAX_BYTES = 50 * 1024 * 1024 // matches the bucket limit

export default function FileUploader({
  userId,
  subjectId,
}: {
  userId: string
  subjectId: string
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState<string[]>([])

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return
    setBusy(true)
    setMsgs([])
    const supabase = createClient()
    const problems: string[] = []

    for (const file of Array.from(list)) {
      if (file.size > MAX_BYTES) {
        problems.push(`${file.name}: أكبر من 50MB`)
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
    setBusy(false)
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
        className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-700 px-4 py-8 text-center text-slate-400 hover:border-teal-500"
      >
        <span>{busy ? 'جارٍ الرفع...' : 'اسحب الملفات هنا أو اضغط للاختيار'}</span>
        <small>PDF · PPTX · DOCX · TXT · صور · صوت (حتى 50MB للملف)</small>
        <input
          ref={input}
          type="file"
          multiple
          disabled={busy}
          accept=".pdf,.pptx,.docx,.txt,.md,image/*,audio/*,video/*"
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </label>
      {msgs.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-red-400">
          {msgs.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
