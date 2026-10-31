import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GeminiError, apiKeys, generate, uploadFile, type GeminiPart } from '@/lib/gemini'
import { SYS, reviewPrompt, type NotesLang } from '@/lib/prompts'
import { cleanMarkdown } from '@/lib/clean'
import { kindOf, mimeFor } from '@/lib/filekind'
import { parsePartName, planChunks, spreadDuration, type FilePart } from '@/lib/parts'
import { tracker } from '@/lib/usage'
import { guardTranscribeQuota } from '@/lib/quota'
import { notifyReady, outputUrl, siteOrigin } from '@/lib/telegram'
import { PDFDocument } from 'pdf-lib'

export const maxDuration = 300

const SEG = 300 // seconds of audio per request
const TEXT_CHUNK = 9000
const PAGES_PER_CHUNK = 6
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Parts = Record<string, string>
type GemRec = { uri: string; mime: string; key: number; at: number }
type Data = {
  total: number
  kind: string
  lang: NotesLang
  dur: number
  pages?: number
  reviewed?: Record<string, boolean>
  parts: Parts
  gemini: GemRec | null
  // hidden multi-part source (ONE record, N storage objects):
  plist?: FilePart[]
  durs?: number[] // per-part durations (media)
  pagesArr?: number[] // per-part page counts (doc)
  gem?: (GemRec | null)[] // per-part uploads to the AI service
  custom?: string
}

const fail = (error: string, status = 400, code = 'other') => NextResponse.json({ error, code }, { status })
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

// A valid `parts` jsonb turns the row into a hidden multi-part source. Part 0
// is always the row's own storage_path, so nothing can drift out of sync.
function normalizeParts(raw: unknown, fallbackPath: string, fallbackName: string): FilePart[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null
  const list: FilePart[] = []
  for (let k = 0; k < raw.length; k++) {
    const p = raw[k] as Record<string, unknown>
    const path = typeof p?.path === 'string' && p.path ? p.path : k === 0 ? fallbackPath : ''
    if (!path) return null
    list.push({
      path,
      name: typeof p?.name === 'string' && p.name ? p.name : fallbackName,
      size: Number(p?.size) > 0 ? Number(p.size) : 1,
      dur: Number(p?.dur) > 0 ? Number(p.dur) : undefined,
      pages: Number(p?.pages) > 0 ? Number(p.pages) : undefined,
    })
  }
  list[0] = { ...list[0], path: fallbackPath }
  return list
}

export async function POST(req: Request) {
  try {
    return await handle(req)
  } catch (e) {
    if (e instanceof GeminiError) return fail(e.message, e.status, e.code)
    return fail(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}

async function handle(req: Request) {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) return fail('Please log in again.', 401)

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
  const custom = typeof body.custom === 'string' ? body.custom.trim().slice(0, 600) : ''
  const action = body.action
  if (action !== 'start' && action !== 'chunk' && action !== 'review') return fail('Invalid action')

  const keys = apiKeys()
  if (keys.length === 0) return fail('AI is not configured yet: add GEMINI_API_KEYS in Vercel.', 503, 'config')

  const { data: file } = await supabase
    .from('files')
    .select('id, name, storage_path, mime, subject_id, source_url, parts')
    .eq('id', fileId)
    .single()
  if (!file) return fail('File not found', 404)

  const kind = kindOf(file.name, file.mime)
  if (kind === 'unsupported') return fail('This file type is not supported yet. Export DOCX/PPTX to PDF first.', 415)

  // Audio/video tokens are enormous and meaningless to students: media
  // transcription is metered in monthly HOURS instead, so its calls are kept
  // out of the daily token budget. Documents/text still report their tokens.
  const trk = tracker(supabase, 'transcribe', { noTokens: kind === 'media' })

  const plist = normalizeParts(file.parts, file.storage_path, file.name)

  const { data: out } = await supabase
    .from('outputs')
    .select('id, data')
    .eq('file_id', fileId)
    .eq('kind', 'transcript')
    .maybeSingle()
  const old = (out?.data ?? null) as Data | null

  // All parts of one source live under the same AI key, so a resumed run keeps
  // reusing what is already uploaded instead of re-uploading half the lecture.
  const keyIndex = plist
    ? (old?.gem?.find((g) => g)?.key ?? Math.floor(Math.random() * keys.length)) % keys.length
    : old?.gemini
      ? old.gemini.key % keys.length
      : Math.floor(Math.random() * keys.length)

  const downloadPart = async (path: string) => {
    const { data: blob, error } = await supabase.storage.from('lecture-files').download(path)
    if (!blob) throw new Error(error?.message ?? 'Could not read the file from storage.')
    return blob
  }
  const download = () => downloadPart(file.storage_path)
  const setError = async (msg: string) => {
    await supabase.from('files').update({ ai_status: 'error', ai_error: msg.slice(0, 300) }).eq('id', fileId)
  }

  // Upload one hidden part to the AI service (the row's own object for part 0).
  const uploadPart = async (p: number, key: number): Promise<GemRec> => {
    const part = plist![p]
    const mime = mimeFor(part.name, kind === 'doc' ? 'application/pdf' : file.mime)
    const blob = await downloadPart(part.path)
    const up = await uploadFile(keys[key], await blob.arrayBuffer(), mime, part.name)
    return { uri: up.uri, mime, key, at: Date.now() }
  }

  // A split recording ("Lecture (2-3).mp3") continues the previous part, so the
  // tail of that part's transcript keeps the model from restarting mid-sentence.
  // Only needed for legacy rows whose parts are separate records; hidden parts
  // get their context from the previous chunk of the same transcript.
  const siblingPrev = async (): Promise<string> => {
    const p = parsePartName(file.name)
    if (!p || p.idx <= 1) return ''
    const ext = file.name.slice(file.name.lastIndexOf('.'))
    const { data: pf } = await supabase
      .from('files')
      .select('id')
      .eq('subject_id', file.subject_id)
      .eq('name', `${p.base} (${p.idx - 1}-${p.total})${ext}`)
      .maybeSingle()
    if (!pf) return ''
    const { data: po } = await supabase
      .from('outputs')
      .select('content')
      .eq('file_id', pf.id)
      .eq('kind', 'transcript')
      .maybeSingle()
    return ((po?.content as string) ?? '').slice(-400)
  }

  // ---- START: plan the chunks, upload the file to the AI service, create/reset the output row ----
  if (action === 'start') {
    // The hours/tokens gate: charged ONCE per file, right before the first
    // transcript row is created — resuming or restarting the same recording
    // never charges again. Media is charged its REAL duration against the
    // monthly hours budget; documents/text only pass the daily token check.
    let chargedSeconds = 0
    try {
      const restart = body.restart === true
      const duration = Number(body.duration) > 0 ? Number(body.duration) : 0
      let total = 1
      let pages = 0
      let docBuf: ArrayBuffer | null = null
      let dur = duration
      let durs: number[] | undefined
      let pagesArr: number[] | undefined
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
              { light: true, max: 20, budgetMs: 25000, track: trk }
            )
            dur = parseInt(ans.replace(/[^0-9]/g, ''), 10) || 0
          } catch {
            dur = 0
          }
        }
        if (plist) {
          // One recording cut into hidden parts: prefer the real per-part
          // durations captured at upload time, else spread the known duration
          // across parts by their bytes (same file => same bitrate).
          const sizes = plist.map((p) => p.size || 1)
          const stored = plist.map((p) => p.dur ?? 0)
          durs = stored.every((d) => d > 0)
            ? stored
            : dur > 0
              ? sizes.map((s) => (dur * s) / sizes[0]) // client duration = part 0's duration
              : spreadDuration(0, sizes)
          total = durs.reduce((a, d) => a + Math.ceil(d / SEG), 0)
          dur = durs.reduce((a, b) => a + b, 0)
        } else {
          total = dur ? Math.ceil(dur / SEG) : 60
        }
      } else if (kind === 'doc' && (/pdf/i.test(file.mime ?? '') || /\.pdf$/i.test(file.name))) {
        if (plist) {
          pagesArr = []
          for (const p of plist) {
            if (p.pages) {
              pagesArr.push(p.pages)
              continue
            }
            // legacy parts carry no page counts: count them once, server-side
            const doc = await PDFDocument.load(await (await downloadPart(p.path)).arrayBuffer(), { ignoreEncryption: true })
            pagesArr.push(doc.getPageCount())
          }
          pages = pagesArr.reduce((a, b) => a + b, 0)
          total = pagesArr.reduce((a, n) => a + Math.max(1, Math.ceil(n / PAGES_PER_CHUNK)), 0)
        } else {
          docBuf = await (await download()).arrayBuffer()
          try {
            pages = (await PDFDocument.load(docBuf, { ignoreEncryption: true })).getPageCount()
          } catch {
            pages = 0
          }
          if (pages > 0) total = Math.max(1, Math.ceil(pages / PAGES_PER_CHUNK))
        }
      }

      const resumable =
        !restart && !!old && old.total === total && old.kind === kind &&
        (!plist || (old.plist?.length === plist.length && old.plist[plist.length - 1].path === plist[plist.length - 1].path))
      const parts: Parts = resumable ? old!.parts : {}

      if (!old) {
        const q = await guardTranscribeQuota(supabase, kind === 'media', Math.ceil(dur || 0))
        if (!q.ok) return fail(q.error, q.status, q.code)
        if (kind === 'media') chargedSeconds = Math.ceil(dur || 0)
      }

      let gemini: Data['gemini'] = null
      let gem: Data['gem'] | null = null
      if (kind === 'media' || kind === 'doc') {
        if (youtube) {
          gemini = { uri: file.source_url as string, mime: '', key: keyIndex, at: Date.now() }
        } else if (plist) {
          // parts are uploaded lazily, one per chunk; prime part 0 now so the
          // first chunk starts instantly
          gem = resumable && old!.gem ? old!.gem : plist.map(() => null)
          if (!gem[0]) {
            gem[0] = await uploadPart(0, keyIndex)
          } else if (gem[0].key !== keyIndex || Date.now() - gem[0].at > 40 * 3600e3) {
            gem[0] = await uploadPart(0, keyIndex)
          }
        } else {
          const fresh =
            resumable && old!.gemini && old!.gemini.key === keyIndex && Date.now() - old!.gemini.at < 40 * 3600e3
          if (fresh) gemini = old!.gemini
          else {
            const mime = mimeFor(file.name, file.mime)
            const up = await uploadFile(keys[keyIndex], docBuf ?? (await (await download()).arrayBuffer()), mime, file.name)
            gemini = { uri: up.uri, mime, key: keyIndex, at: Date.now() }
          }
        }
      }

      const data: Data = {
        total, kind, lang: resumable ? old!.lang : lang, dur: dur || (old?.dur ?? 0),
        pages: pages || old?.pages, reviewed: resumable ? (old!.reviewed ?? {}) : {}, parts, gemini,
        plist: plist ?? undefined, durs, pagesArr, gem: gem ?? undefined,
        custom: custom || (resumable ? old?.custom : undefined),
      }
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
      if (chargedSeconds > 0) {
        after(async () => { try { await supabase.rpc('refund_transcribe_quota', { p_media: true, p_seconds: chargedSeconds }) } catch {} })
      }
      await setError(e instanceof Error ? e.message : 'Failed to start')
      throw e
    }
  }

  // ---- CHUNK: generate one part and save it immediately ----
  if (!out || !old) return fail('Start the transcription first.', 409)
  const i = Number(body.index)
  if (!Number.isInteger(i) || i < 0 || i >= old.total) return fail('Invalid part')

  // Which hidden part does this global chunk belong to, and which chunk inside
  // that part? Deterministic from the per-part durations / page counts.
  const thePlan = (() => {
    if (!old.plist) return null
    if (old.kind === 'media' && old.durs?.length) return planChunks(old.durs.map((d) => Math.ceil(d / SEG)))
    if (old.pagesArr?.length) return planChunks(old.pagesArr.map((n) => Math.max(1, Math.ceil(n / PAGES_PER_CHUNK))))
    return old.plist.map((_, p) => ({ part: p, local: 0 }))
  })()

  // ---- REVIEW: proofread one finished part before it is shown to anyone ----
  if (action === 'review') {
    try {
      const raw = old.parts[String(i)]
      if (!raw) return fail('Nothing to review yet.', 409)
      const reviewed = { ...(old.reviewed ?? {}) }
      const parts2 = { ...old.parts }
      if (!reviewed[String(i)]) {
        let polished = raw
        try {
          const txt = await generate([{ text: reviewPrompt(raw) }], { max: 16000, track: trk })
          const cleaned = cleanMarkdown(txt)
          // Never accept a version that lost a large part of the content.
          if (cleaned.length >= raw.length * 0.6) polished = cleaned
        } catch (e) {
          if (e instanceof GeminiError && e.code === 'quota') throw e
        }
        parts2[String(i)] = polished
        reviewed[String(i)] = true
      }
      const doneAll = Array.from({ length: old.total }, (_, k) => k).every((k) => reviewed[String(k)])
      await supabase
        .from('outputs')
        .update({ content: joinParts(parts2), data: { ...old, parts: parts2, reviewed } })
        .eq('id', out.id)
      if (doneAll) {
        // Edge-triggered flip: update only rows NOT already done, so the "your
        // transcript is ready" notification fires exactly once per file even if
        // reviews are re-run after a resumed session.
        const { data: flipped } = await supabase
          .from('files')
          .update({ ai_status: 'done', ai_error: null })
          .eq('id', fileId)
          .neq('ai_status', 'done')
          .select('id')
        if (flipped && flipped.length > 0) {
          const title = file.name.replace(/\.[^.]+$/, '').replace(/[_#]+/g, ' ').trim() || 'Lecture'
          const url = outputUrl(siteOrigin(req), file.subject_id, fileId, 'transcript')
          const text = joinParts(parts2)
          after(() => notifyReady(supabase, userId, 'transcript', { title, url, file: { text } }))
        }
      }
      return NextResponse.json({ ok: true, index: i, complete: doneAll })
    } catch (e) {
      if (e instanceof GeminiError && e.code === 'quota') throw e
      await setError(e instanceof Error ? e.message : 'Failed')
      throw e
    }
  }

  try {
    const prevIdx = Object.keys(old.parts).map(Number).filter((k) => k < i).sort((a, b) => b - a)[0]
    let prev = prevIdx !== undefined ? old.parts[String(prevIdx)].slice(-400) : ''
    if (!prev && kind === 'media') prev = await siblingPrev()
    const sys = SYS(old.lang, old.custom)
    let parts: GeminiPart[]
    let pinned = false
    let gemRec: GemRec | null = old.gemini

    if (kind === 'text') {
      const chunks = splitText(await (await download()).text())
      const ask = `هذا الجزء رقم ${i + 1} من ${chunks.length} من تفريغ المحاضرة.${
        prev ? '\nآخر ما كُتب في الجزء السابق:\n' + prev + '\nكمّل مباشرة دون تكرار.' : ''
      }\n\nنص التفريغ:\n${chunks[i]}`
      parts = [{ text: sys + '\n\n' + ask }]
    } else {
      if (!old.gemini && !old.plist) return fail('Start the transcription first.', 409)
      pinned = true
      if (thePlan) {
        // hidden multi-part: make sure THIS part is uploaded, then ask about
        // its local time range / page range
        const p = thePlan[i].part
        gemRec = old.gem?.[p] ?? null
        if (!gemRec || gemRec.key !== keyIndex || Date.now() - gemRec.at > 40 * 3600e3) {
          gemRec = await uploadPart(p, keyIndex)
          const gem = [...(old.gem ?? old.plist!.map(() => null))]
          gem[p] = gemRec
          await supabase.from('outputs').update({ data: { ...old, gem } }).eq('id', out.id)
          old.gem = gem
        }
      }
      if (!gemRec) return fail('Start the transcription first.', 409)
      const src: GeminiPart = gemRec.mime
        ? { fileData: { mimeType: gemRec.mime, fileUri: gemRec.uri } }
        : { fileData: { fileUri: gemRec.uri } }
      let ask: string
      if (kind === 'media') {
        let a: number
        let b: number
        if (thePlan && old.durs) {
          const p = thePlan[i].part
          const d = old.durs[p] ?? 0
          a = thePlan[i].local * SEG
          b = d ? Math.min((thePlan[i].local + 1) * SEG, d) : (thePlan[i].local + 1) * SEG
        } else {
          a = i * SEG
          b = old.dur ? Math.min((i + 1) * SEG, old.dur) : (i + 1) * SEG
        }
        ask =
          `Transcribe ONLY from ${mm(a)} to ${mm(b)} of this recording. If there is no speech in that range, reply exactly NO_MORE_AUDIO.` +
          (prev ? `\nThe previous part ended with:\n${prev}\nContinue naturally without repeating it.` : '')
      } else if (thePlan && old.pagesArr) {
        const p = thePlan[i].part
        const pc = old.pagesArr[p] ?? 0
        const a = thePlan[i].local * PAGES_PER_CHUNK + 1
        const b = pc ? Math.min(pc, (thePlan[i].local + 1) * PAGES_PER_CHUNK) : (thePlan[i].local + 1) * PAGES_PER_CHUNK
        ask =
          `Convert ONLY pages ${a} to ${b} of this document into organized study notes. Do not skip anything on those pages.` +
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

    let text: string
    try {
      text = await generate(parts, { max: 16000, pinned, keyIndex: gemRec?.key, track: trk })
    } catch (e) {
      // This key is out of quota: move the current part to the next key and ask the browser to retry.
      if (e instanceof GeminiError && e.code === 'quota' && pinned && keys.length > 1 && gemRec?.mime) {
        const nk = (gemRec.key + 1) % keys.length
        if (thePlan) {
          const p = thePlan[i].part
          const rec = await uploadPart(p, nk)
          const gem = [...(old.gem ?? old.plist!.map(() => null))]
          gem[p] = rec
          await supabase.from('outputs').update({ data: { ...old, gem } }).eq('id', out.id)
        } else {
          const up = await uploadFile(keys[nk], await (await download()).arrayBuffer(), gemRec.mime, file.name)
          await supabase
            .from('outputs')
            .update({ data: { ...old, gemini: { uri: up.uri, mime: gemRec.mime, key: nk, at: Date.now() } } })
            .eq('id', out.id)
        }
        return NextResponse.json({ error: 'Switching to another AI key…', code: 'retry', retry: true }, { status: 503 })
      }
      throw e
    }
    const newParts = { ...old.parts }
    let total = old.total
    // "No more audio" is only trusted when the ENTIRE reply is that token. If it
    // merely appears inside a real transcript (the model mentioning it, or the
    // reviewer echoing it), the whole tail of the lecture would be cut off.
    if (kind === 'media' && /^\s*NO[\s_-]?MORE[\s_-]?AUDIO\.?\s*$/i.test(text)) total = i
    else newParts[String(i)] = cleanMarkdown(text)

    if (total === 0) {
      await setError('No speech was found in this file.')
      return fail('No speech was found in this file.', 422)
    }
    const complete = Array.from({ length: total }, (_, k) => k).every((k) => newParts[String(k)])
    await supabase
      .from('outputs')
      .update({ content: joinParts(newParts), data: { ...old, parts: newParts, total } })
      .eq('id', out.id)
    return NextResponse.json({ ok: true, index: i, ended: total !== old.total, complete })
  } catch (e) {
    await setError(e instanceof Error ? e.message : 'Failed')
    throw e
  }
}
