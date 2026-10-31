'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ApiError, mediaDuration, postJson } from '@/lib/client-api'
import Icon from './Icon'
import type { Dict } from '@/lib/dict'
import type { FileKind } from '@/lib/filekind'

type Lang = 'ar' | 'en' | 'fa'
export type JobFile = {
  id: string
  name: string
  path: string
  kind: FileKind
  mime: string
  url: string
  isLink: boolean
  subjectId: string
}
export type Job = {
  id: string
  file: JobFile
  lang: Lang
  custom?: string
  pct: number
  msg: string
  state: 'running' | 'done' | 'error'
  error?: string
}
type Labels = { ai: Dict['ai']; errors: Dict['errors'] }
type Ctx = {
  jobs: Record<string, Job>
  start: (f: JobFile, lang: Lang, restart: boolean, custom?: string) => void
  startMany: (fs: JobFile[], lang: Lang, custom?: string) => void
}

const C = createContext<Ctx>({ jobs: {}, start: () => {}, startMany: () => {} })
export const useJobs = () => useContext(C)

// Transcription runs here, above the pages, so opening another source or another subject never stops it.
export default function JobsProvider({ labels, children }: { labels: Labels; children: ReactNode }) {
  const router = useRouter()
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const running = useRef(new Set<string>())
  const L = useRef(labels)
  L.current = labels

  const patch = useCallback((id: string, p: Partial<Job>) => {
    setJobs((j) => (j[id] ? { ...j, [id]: { ...j[id], ...p } } : j))
  }, [])

  const friendly = (e: unknown) => {
    if (e instanceof ApiError) return (L.current.errors as Record<string, string>)[e.code] ?? e.message
    return e instanceof Error ? e.message : L.current.errors.other
  }

  const work = useCallback(
    async (f: JobFile, lang: Lang, restart: boolean, custom?: string) => {
      const set = (p: Partial<Job>) => patch(f.id, p)
      set({ pct: 0, msg: L.current.ai.preparing })
      let url = f.url
      if (!url && f.kind === 'media' && !f.isLink) {
        const { data } = await createClient().storage.from('lecture-files').createSignedUrl(f.path, 600)
        url = data?.signedUrl ?? ''
      }
      const duration = f.kind === 'media' && url && !f.isLink ? await mediaDuration(url, f.mime.startsWith('video')) : 0
      const s = await postJson('/api/ai/transcribe', { action: 'start', fileId: f.id, lang, duration, restart, custom })
      let total = s.total ?? 1
      const done = new Set(s.done ?? [])
      for (let i = 0; i < total; i++) {
        if (!done.has(i)) {
          set({ msg: L.current.ai.part })
          const c = await postJson('/api/ai/transcribe', { action: 'chunk', fileId: f.id, index: i })
          if (c.ended) {
            total = i
            break
          }
        }
        set({ pct: Math.round(((i + 1) / total) * 60) })
      }
      for (let i = 0; i < total; i++) {
        set({ msg: L.current.ai.polishing })
        await postJson('/api/ai/transcribe', { action: 'review', fileId: f.id, index: i })
        set({ pct: 60 + Math.round(((i + 1) / total) * 40) })
      }
    },
    [patch]
  )

  const execute = useCallback(
    async (f: JobFile, lang: Lang, restart: boolean, custom?: string) => {
      if (running.current.has(f.id)) return
      running.current.add(f.id)
      setJobs((j) => ({ ...j, [f.id]: { id: f.id, file: f, lang, custom, pct: 0, msg: L.current.ai.preparing, state: 'running' } }))
      try {
        await work(f, lang, restart, custom)
        patch(f.id, { pct: 100, state: 'done', msg: '' })
      } catch (e) {
        patch(f.id, { state: 'error', error: friendly(e) })
      } finally {
        running.current.delete(f.id)
        router.refresh()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [work, patch, router]
  )

  const start = useCallback((f: JobFile, lang: Lang, restart: boolean, custom?: string) => void execute(f, lang, restart, custom), [execute])
  const startMany = useCallback(
    (fs: JobFile[], lang: Lang, custom?: string) => {
      void (async () => {
        for (const f of fs) await execute(f, lang, false, custom)
      })()
    },
    [execute]
  )
  const dismiss = (id: string) =>
    setJobs((j) => {
      const { [id]: _drop, ...rest } = j
      void _drop
      return rest
    })

  const list = Object.values(jobs)
  return (
    <C.Provider value={{ jobs, start, startMany }}>
      {children}
      {list.length > 0 && (
        <div className="fixed bottom-20 end-4 z-40 flex w-[min(92vw,340px)] flex-col gap-2 min-[1100px]:bottom-4">
          {list.map((j) => (
            <div key={j.id} className="panel p-3 ring-1 ring-black/5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto">{j.file.name}</span>
                {j.state !== 'running' && (
                  <button type="button" className="btn btn-icon !h-7 !w-7" aria-label="Dismiss" onClick={() => dismiss(j.id)}>
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                )}
              </div>
              {j.state === 'running' && (
                <div className="mt-2">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
                    <span className="flex items-center gap-2"><span className="spinner" />{j.msg}</span>
                    <span dir="ltr">{j.pct}%</span>
                  </div>
                  <div className="bar"><i style={{ width: `${Math.max(j.pct, 4)}%` }} /></div>
                </div>
              )}
              {j.state === 'done' && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="chip">{labels.ai.done}</span>
                  <Link scroll={false} href={`/subjects/${j.file.subjectId}?f=${j.id}&tab=transcript&p=notes`} className="btn btn-soft btn-sm">
                    {labels.ai.view}
                  </Link>
                </div>
              )}
              {j.state === 'error' && (
                <div className="mt-2 flex flex-col gap-2">
                  <p dir="auto" className="text-xs leading-5 text-danger">{j.error}</p>
                  <button type="button" className="btn btn-primary btn-sm w-fit" onClick={() => start(j.file, j.lang, false, j.custom)}>
                    {labels.ai.resume}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </C.Provider>
  )
}
