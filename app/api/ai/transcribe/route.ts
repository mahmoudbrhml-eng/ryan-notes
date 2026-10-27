import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, apiKeys, generate, keyIndexFor, uploadFile, type GeminiPart } from '@/lib/gemini'
import { SYS, type NotesLang } from '@/lib/prompts'
import { kindOf, mimeFor } from '@/lib/filekind'
import { PDFDocument } from 'pdf-lib'

export const maxDuration = 60

const SEG = 300 // seconds of audio per request
const TEXT_CHUNK = 9000
const PAGES_PER_CHUNK = 6
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 150)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Parts = Record<string, string>
type Data = {
  total: number
  kind: string
  lang: NotesLang
  dur: number
  pages?: number
  parts: Parts
  gemini: { uri: string; mime: string; key: number; at: number } | null
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const mm = (s: number) => {
  s = Math.max(0, Math.floor(s))
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
}
function splitText(t: string) {
  const out: string[] = []
  while (t.length > TEXT_CHUNK) {
    let k = t.lastIndexOf('\n', TEXT_CHUNK)
    if (k < 5000) k = t.lastIndexOf(' ', TEXT_CHUNK)
    if (k < 5000) k = TEXT_CHUNK
    out.push(t.slice(0, k))
    t = t.slice(k)
  }
  out.push(t)
  return out
}
const joinParts = (p: Parts) =>
  Object.keys(p).map(Number).sort((a, b) => a - b).map((k) => p[String(k)]).join('\n\n')

export async function POST(req: Request) {
  try {
    return await handle(req)
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status)
    return fail(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}

async function handle(req: Request) {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) return fail('Please log in again.', 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return fail('Invalid request')
  }
  const fileId = String(body.fileId ?? '')
  if (!UUID.test(fileId)) return fail('Invalid file')
  const l = body.lang
  const lang: NotesLang = l === 'en' || l === 'fa' ? l : 'ar'
  const action = body.action
  if (action !== 'start' && action !== 'chunk') return fail('Invalid action')

  const keys = apiKeys()
  if (keys.length === 0) return fail('AI is not configured yet: add GEMINI_API_KEYS in Vercel.', 503)

  const { data: file } = await supabase
    .from('files')
    .select('id, name, storage_path, mime, subject_id, source_url')
    .eq('id', fileId)
    .single()
  if (!file) return fail('File not found', 404)

  const kind = kindOf(file.name, file.mime)
  if (kind === 'unsupported') return fail('This file type is not supported yet. Export DOCX/PPTX to PDF first.', 415)

  const { data: used } = await supabase.rpc('bump_usage')
  if (typeof used === 'number' && used > DAILY_LIMIT) return fail('Daily AI limit reached. Try again tomorrow.', 429)

  const keyIndex = keyIndexFor(file.id, keys.length)
  const { data: out } = await supabase
    .from('outputs')
    .select('id, data')
    .eq('file_id', fileId)
    .eq('kind', 'transcript')
    .maybeSingle()
  const old = (out?.data ?? null) as Data | null

  const download = async () => {
    const { data: blob, error } = await supabase.storage.from('lecture-files').download(file.storage_path)
    if (!blob) throw new Error(error?.message ?? 'Could not read the file from storage.')
    return blob
  }
  const setError = async (msg: string) => {
    await supabase.from('files').update({ ai_status: 'error', ai_error: msg.slice(0, 300) }).eq('id', fileId)
  }

  // ---- START: plan the chunks, upload the file to the AI service, create/reset the output row ----
  if (action === 'start') {
    try {
      const restart = body.restart === true
      const duration = Number(body.duration) > 0 ? Number(body.duration) : 0
      let total = 1
      let pages = 0
      let docBuf: ArrayBuffer | null = null
      let dur = duration
      const youtube = file.mime === 'video/youtube' && !!file.source_url
      if (kind === 'text') total = splitText(await (await download()).text()).length
      else if (kind === 'media') {
        if (youtube && !dur) {
          try {
            const ans = await generate(
              [
                { fileData: { fileUri: file.source_url as string } },
                { text: 'Reply with ONLY the total duration of this video in seconds, as a single integer.' },
              ],
              { light: true, max: 20, budgetMs: 25000 }
            )
            dur = parseInt(ans.replace(/[^0-9]/g, ''), 10) || 0
          } catch {
            dur = 0
          }
        }
        total = dur ? Math.ceil(dur / SEG) : 60
      } else if (kind === 'doc' && (/pdf/i.test(file.mime ?? '') || /\.pdf$/i.test(file.name))) {
        docBuf = await (await download()).arrayBuffer()
        try {
          pages = (await PDFDocument.load(docBuf, { ignoreEncryption: true })).getPageCount()
        } catch {
          pages = 0
        }
        if (pages > 0) total = Math.max(1, Math.ceil(pages / PAGES_PER_CHUNK))
      }

      const resumable = !restart && old && old.total === total && old.kind === kind
      const parts: Parts = resumable ? old.parts : {}

      let gemini: Data['gemini'] = null
      if (kind === 'media' || kind === 'doc') {
        const fresh =
          resumable && old.gemini && old.gemini.key === keyIndex && Date.now() - old.gemini.at < 40 * 3600e3
        if (fresh) gemini = old.gemini
        else if (youtube) gemini = { uri: file.source_url as string, mime: '', key: keyIndex, at: Date.now() }
        else {
          const mime = mimeFor(file.name, file.mime)
          const up = await uploadFile(keys[keyIndex], docBuf ?? (await (await download()).arrayBuffer()), mime, file.name)
          gemini = { uri: up.uri, mime, key: keyIndex, at: Date.now() }
        }
      }

      const data: Data = { total, kind, lang: resumable ? old.lang : lang, dur: dur || (old?.dur ?? 0), pages: pages || old?.pages, parts, gemini }
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_#]+/g, ' ').trim() || 'Lecture'
      if (out) {
        await supabase.from('outputs').update({ data, lang: data.lang, content: joinParts(parts), title }).eq('id', out.id)
      } else {
        await supabase.from('outputs').insert({
          subject_id: file.subject_id, file_id: file.id, kind: 'transcript', title, lang, content: '', data,
        })
      }
      await supabase.from('files').update({ ai_status: 'processing', ai_error: null }).eq('id', fileId)
      return NextResponse.json({ total, kind, done: Object.keys(parts).map(Number) })
    } catch (e) {
      await setError(e instanceof Error ? e.message : 'Failed to start')
      throw e
    }
  }

  // ---- CHUNK: generate one part and save it immediately ----
  if (!out || !old) return fail('Start the transcription first.', 409)
  const i = Number(body.index)
  if (!Number.isInteger(i) || i < 0 || i >= old.total) return fail('Invalid part')

  try {
    const prevIdx = Object.keys(old.parts).map(Number).filter((k) => k < i).sort((a, b) => b - a)[0]
    const prev = prevIdx !== undefined ? old.parts[String(prevIdx)].slice(-400) : ''
    const sys = SYS(old.lang)
    let parts: GeminiPart[]
    let pinned = false

    if (kind === 'text') {
      const chunks = splitText(await (await download()).text())
      const ask = `هذا الجزء رقم ${i + 1} من ${chunks.length} من تفريغ المحاضرة.${
        prev ? '\nآخر ما كُتب في الجزء السابق:\n' + prev + '\nكمّل مباشرة دون تكرار.' : ''
      }\n\nنص التفريغ:\n${chunks[i]}`
      parts = [{ text: sys + '\n\n' + ask }]
    } else {
      if (!old.gemini) return fail('Start the transcription first.', 409)
      pinned = true
      const src: GeminiPart = old.gemini.mime
        ? { fileData: { mimeType: old.gemini.mime, fileUri: old.gemini.uri } }
        : { fileData: { fileUri: old.gemini.uri } }
      let ask: string
      if (kind === 'media') {
        const a = i * SEG
        const b = old.dur ? Math.min((i + 1) * SEG, old.dur) : (i + 1) * SEG
        ask =
          `Transcribe ONLY from ${mm(a)} to ${mm(b)} of this recording. If there is no speech in that range, reply exactly NO_MORE_AUDIO.` +
          (prev ? `\nThe previous part ended with:\n${prev}\nContinue naturally without repeating it.` : '')
      } else if (old.pages) {
        const a = i * PAGES_PER_CHUNK + 1
        const b = Math.min(old.pages, (i + 1) * PAGES_PER_CHUNK)
        ask =
          `Convert ONLY pages ${a} to ${b} of this document into organized study notes. Do not skip anything on those pages.` +
          (prev ? `\nThe previous part ended with:\n${prev}\nContinue naturally without repeating it.` : '')
      } else ask = 'Turn this document into organized study notes covering all of it.'
      parts = [src, { text: sys + '\n\n' + ask }]
    }

    const text = await generate(parts, { max: 16000, pinned, keyIndex: old.gemini?.key })
    const newParts = { ...old.parts }
    let total = old.total
    if (kind === 'media' && /NO_MORE_AUDIO/.test(text)) total = i
    else newParts[String(i)] = text.trim()

    if (total === 0) {
      await setError('No speech was found in this file.')
      return fail('No speech was found in this file.', 422)
    }
    const complete = Array.from({ length: total }, (_, k) => k).every((k) => newParts[String(k)])
    await supabase
      .from('outputs')
      .update({ content: joinParts(newParts), data: { ...old, parts: newParts, total } })
      .eq('id', out.id)
    if (complete) await supabase.from('files').update({ ai_status: 'done', ai_error: null }).eq('id', fileId)
    return NextResponse.json({ ok: true, index: i, ended: total !== old.total, complete })
  } catch (e) {
    await setError(e instanceof Error ? e.message : 'Failed')
    throw e
  }
}
