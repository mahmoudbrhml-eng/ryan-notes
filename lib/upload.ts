'use client'

// Shared upload pipeline used by both add-source entry points (the Sources
// panel and the quick "+" button inside the notes header): every file above
// the ~50MB-per-object storage cap is made smaller in the browser first, then
// uploaded part by part, with device-side failures reported for diagnosis.

import { createClient } from '@/lib/supabase/client'
import { compressMedia, splitPdf, compressImage, looksLikePdf, looksLikeImage } from '@/lib/compress'
import type { FilePart } from '@/lib/parts'

export const MAX_MEDIA = 1024 * 1024 * 1024 // media is streamed through the compressor
export const MAX_DOC = 300 * 1024 * 1024 // PDFs are split in the browser first
export const SAFE_RAW = 48 * 1024 * 1024 // largest object uploaded untouched
export const COMPRESS_ABOVE = 45 * 1024 * 1024

const isMedia = (f: File) =>
  /^(audio|video)\//.test(f.type) ||
  /\.(mp3|m4a|wav|ogg|oga|aac|flac|mp4|webm|mov|mkv|avi|3gp|amr|opus|wma)$/i.test(f.name)

export type PrepStage = 'tooling' | 'compressing' | 'splitting' | 'uploading'

// Localized strings the caller must provide (keeps this module dict-free).
export type UploadMsgs = {
  storageLimit: string
  compressBigFail: string
  splitFail: string
  tooBig: string
}

export type UploadOutcome = { ok: true; parts: number } | { ok: false; error: string }

function reportFail(stage: string, file: File, message?: string) {
  void fetch('/api/log/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage, name: file.name, size: file.size, mime: file.type, message: message ?? null }),
    keepalive: true,
  }).catch(() => {})
}

// Prepares one file (compress / split / re-encode as needed) and uploads it.
// A split file is stored as SEVERAL objects but inserted as ONE `files` row:
// the extra parts live in the row's `parts` jsonb, invisible to the user —
// transcription later walks them behind the scenes. Parts upload sequentially
// so a huge lecture never opens many parallel connections on a phone.
export async function prepareAndUpload(
  file: File,
  opts: { userId: string; subjectId: string; msgs: UploadMsgs; on: (stage: PrepStage, pct?: number) => void },
): Promise<UploadOutcome> {
  const { userId, subjectId, msgs, on } = opts
  const supabase = createClient()
  const media = isMedia(file)

  if (file.size > (media ? MAX_MEDIA : MAX_DOC)) {
    reportFail('too-big', file)
    return { ok: false, error: msgs.tooBig }
  }

  // Decide what actually goes to storage: the file itself, a compressed
  // version, or a list of parts. Anything above the ~50MB storage cap must be
  // made smaller in the browser first; media is compressed from 45MB up
  // because that also makes uploads much faster.
  let up: File[] = [file]
  if (media && file.size > COMPRESS_ABOVE) {
    let ok = false
    let lastMsg = ''
    for (let attempt = 0; !ok && attempt < 2; attempt++) {
      try {
        const r = await compressMedia(
          file,
          (pct) => on('compressing', pct),
          (s) => on(s === 'split' ? 'splitting' : 'tooling'),
        )
        up = r.files
        ok = true
      } catch (e) {
        lastMsg = e instanceof Error ? e.message : String(e)
      }
    }
    if (!ok) {
      reportFail('compress-failed', file, lastMsg)
      if (file.size > SAFE_RAW) return { ok: false, error: msgs.compressBigFail }
      up = [file] // small enough to upload as-is
    }
  } else if (looksLikePdf(file) && file.size > SAFE_RAW) {
    let parts: File[] | null = null
    let lastMsg = ''
    for (let attempt = 0; !parts && attempt < 2; attempt++) {
      try {
        parts = await splitPdf(
          file,
          () => on('tooling'),
          (a, b) => on('splitting', Math.round((a / b) * 100)),
        )
      } catch (e) {
        lastMsg = e instanceof Error ? e.message : String(e)
      }
    }
    if (!parts || parts.length === 0) {
      reportFail('split-failed', file, lastMsg)
      return { ok: false, error: msgs.splitFail }
    }
    up = parts
  } else if (looksLikeImage(file) && file.size > SAFE_RAW) {
    try {
      const small = await compressImage(file)
      if (!small) {
        reportFail('image-failed', file, 'no output produced')
        return { ok: false, error: msgs.compressBigFail }
      }
      up = [small]
    } catch (e) {
      reportFail('image-failed', file, e instanceof Error ? e.message : String(e))
      return { ok: false, error: msgs.compressBigFail }
    }
  }

  // Light per-part metadata so transcription can plan chunks across parts
  // without re-downloading them: duration for audio, page count for PDFs.
  // Both are best-effort — the server falls back to size-based estimates.
  const audioDuration = (f: File): Promise<number | undefined> =>
    new Promise((ok) => {
      const a = document.createElement('audio')
      a.preload = 'metadata'
      const url = URL.createObjectURL(f)
      let timer: ReturnType<typeof setTimeout> | null = null
      const done = (v?: number) => {
        if (timer) clearTimeout(timer)
        a.onloadedmetadata = null
        a.onerror = null
        URL.revokeObjectURL(url)
        ok(v)
      }
      timer = setTimeout(() => done(undefined), 6000)
      a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : undefined)
      a.onerror = () => done(undefined)
      a.src = url
    })
  const partMeta = async (f: File): Promise<{ dur?: number; pages?: number }> => {
    try {
      if (looksLikePdf(f)) {
        const { PDFDocument } = await import('pdf-lib')
        const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true })
        return { pages: doc.getPageCount() }
      }
      if (f.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus|wma|amr)$/i.test(f.name)) {
        const dur = await audioDuration(f)
        if (dur) return { dur: Math.round(dur) }
      }
    } catch {
      /* optional — estimation fallbacks cover this */
    }
    return {}
  }

  if (up.length === 1) {
    const upFile = up[0]
    on('uploading')
    const fileId = crypto.randomUUID()
    const isOriginal = upFile === file
    const finalName = isOriginal ? file.name : upFile.name
    const safe = finalName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
    const path = `${userId}/${subjectId}/${fileId}-${safe}`
    const { error: upErr } = await supabase.storage
      .from('lecture-files')
      .upload(path, upFile, { contentType: upFile.type || undefined, upsert: false })
    if (upErr) {
      reportFail('storage-rejected', upFile, upErr.message)
      const localized = /exceeded the maximum allowed size/i.test(upErr.message) ? msgs.storageLimit : upErr.message
      return { ok: false, error: localized }
    }
    const { error: dbErr } = await supabase.from('files').insert({
      id: fileId, subject_id: subjectId, name: finalName, storage_path: path,
      mime: upFile.type || null, size_bytes: upFile.size,
    })
    if (dbErr) {
      await supabase.storage.from('lecture-files').remove([path])
      reportFail('db-failed', upFile, dbErr.message)
      return { ok: false, error: dbErr.message }
    }
    return { ok: true, parts: 1 }
  }

  // Multi-part: upload every object first, then insert ONE row that owns them
  // all. If anything fails mid-way, the already-uploaded objects are removed —
  // a half-uploaded lecture never appears in the user's list.
  on('uploading')
  const metas = await Promise.all(up.map(partMeta))
  const fileId = crypto.randomUUID()
  const uploaded: string[] = []
  const partsJson: FilePart[] = []
  for (let k = 0; k < up.length; k++) {
    const upFile = up[k]
    const safe = upFile.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
    const path = `${userId}/${subjectId}/${fileId}-${k + 1}-${safe}`
    const { error: upErr } = await supabase.storage
      .from('lecture-files')
      .upload(path, upFile, { contentType: upFile.type || undefined, upsert: false })
    if (upErr) {
      if (uploaded.length > 0) await supabase.storage.from('lecture-files').remove(uploaded)
      reportFail('storage-rejected', upFile, upErr.message)
      const localized = /exceeded the maximum allowed size/i.test(upErr.message) ? msgs.storageLimit : upErr.message
      return { ok: false, error: localized }
    }
    uploaded.push(path)
    partsJson.push({ path, name: upFile.name, size: upFile.size, ...metas[k] })
  }
  const { error: dbErr } = await supabase.from('files').insert({
    id: fileId, subject_id: subjectId, name: file.name, storage_path: partsJson[0].path,
    mime: up[0].type || file.type || null, size_bytes: up.reduce((a, f) => a + f.size, 0),
    parts: partsJson,
  })
  if (dbErr) {
    await supabase.storage.from('lecture-files').remove(uploaded)
    reportFail('db-failed', file, dbErr.message)
    return { ok: false, error: dbErr.message }
  }

  return { ok: true, parts: up.length }
}
