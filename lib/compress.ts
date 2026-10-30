'use client'

// Client-side preparation of large media files so every upload fits the
// ~50MB-per-object storage cap (free Supabase plan).
//
// Strategy, cheapest and most reliable first:
// 1. MP3 frame split (pure JS, no engine download): MP3 frames are
//    independent, so a long recording is cut at frame boundaries into
//    several sources in seconds — lossless, works on any device.
// 2. ffmpeg.wasm stream copy split (-c copy, no re-encoding) for other
//    audio containers (m4a…) and, as a last resort, video.
// 3. ffmpeg.wasm re-encode to a compact mono MP3 (the quality ladder), for
//    video (audio-only output) and as the general fallback.
//
// The engine is served from THIS site first (/public/ffmpeg) so it works even
// when public CDNs are blocked; CDN copies remain as fallbacks. Inputs are
// mounted with WORKERFS and streamed, so even a 1GB file never fits in memory.

const SELF_BASE = '/ffmpeg/'
const FFMPEG_BASES = [
  SELF_BASE,
  'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/',
]
const UTIL_BASES = [
  SELF_BASE,
  'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/',
]
const CORE_BASES = [
  SELF_BASE,
  'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/',
]

type FFmpegLike = {
  load(cfg: { coreURL: string; wasmURL: string; classWorkerURL: string }): Promise<boolean>
  exec(args: string[]): Promise<number>
  mount(fsType: string, options: unknown, mountPoint: string): Promise<boolean>
  unmount(mountPoint: string): Promise<boolean>
  createDir(path: string): Promise<boolean>
  deleteDir(path: string): Promise<boolean>
  deleteFile(path: string): Promise<boolean>
  listDir(path: string): Promise<{ name: string; isDir: boolean }[]>
  readFile(path: string): Promise<Uint8Array | string>
  on(evt: 'progress', cb: (e: { progress: number; time?: number }) => void): void
  off(evt: 'progress', cb: (e: { progress: number; time?: number }) => void): void
  on(evt: 'log', cb: (e: { type: string; message: string }) => void): void
  off(evt: 'log', cb: (e: { type: string; message: string }) => void): void
}

declare global {
  interface Window {
    FFmpegWASM?: { FFmpeg: new () => FFmpegLike }
    FFmpegUtil?: { toBlobURL: (url: string, type: string) => Promise<string> }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A stalled CDN/engine download must never hang the upload forever: every
// loading step races against a timeout and the next source is tried instead.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    sleep(ms).then(() => {
      throw new Error('loading timed out')
    }),
  ])
}

function loadScript(src: string): Promise<void> {
  return withTimeout(
    new Promise((ok, err) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = () => ok()
      s.onerror = () => err(new Error(`failed to load ${src}`))
      document.head.appendChild(s)
    }),
    60000,
  )
}

async function firstOK<T>(bases: string[], file: string, fn: (url: string) => Promise<T>): Promise<T> {
  let last: unknown
  for (const b of bases) {
    try {
      return await fn(`${b}${file}`)
    } catch (e) {
      last = e
    }
  }
  throw last ?? new Error('engine sources unavailable')
}

let engine: Promise<FFmpegLike> | null = null

function getEngine(onStage?: (s: Stage) => void): Promise<FFmpegLike> {
  if (!engine) {
    engine = (async () => {
      onStage?.('engine')
      await firstOK(FFMPEG_BASES, 'ffmpeg.js', loadScript)
      if (!window.FFmpegWASM) throw new Error('ffmpeg global missing')
      await firstOK(UTIL_BASES, 'util.js', loadScript)
      if (!window.FFmpegUtil) throw new Error('util global missing')
      const { toBlobURL } = window.FFmpegUtil
      const ff = new window.FFmpegWASM.FFmpeg()
      // The wasm core is ~31MB: allow several minutes on slow connections.
      const [coreURL, wasmURL] = await Promise.all([
        firstOK(CORE_BASES, 'ffmpeg-core.js', (u) => withTimeout(toBlobURL(u, 'text/javascript'), 90000)),
        firstOK(CORE_BASES, 'ffmpeg-core.wasm', (u) => withTimeout(toBlobURL(u, 'application/wasm'), 300000)),
      ])
      const classWorkerURL = await firstOK(FFMPEG_BASES, '814.ffmpeg.js', (u) =>
        withTimeout(toBlobURL(u, 'text/javascript'), 60000),
      )
      // The core is ~31MB; give it room on slow connections (2 tries total).
      for (let i = 0; ; i++) {
        try {
          await ff.load({ coreURL, wasmURL, classWorkerURL })
          break
        } catch (e) {
          if (i >= 1) throw e
          await sleep(1500)
        }
      }
      return ff
    })().catch((e) => {
      engine = null
      throw e
    })
  }
  return engine
}

export type Stage = 'engine' | 'split'
export type CompressResult = {
  files: File[]
  note: 'audio-only' | 'recompressed' | 'split' | null
}

const TARGET = 45 * 1024 * 1024 // re-encode target: safely under the 50MB cap
const HARD_LIMIT = 49 * 1024 * 1024 // above this we refuse: storage rejects >50MB
const COPY_TARGET = 38 * 1024 * 1024 // split parts aim below this
const PASS_TIMEOUT = 20 * 60 * 1000 // a single re-encode pass never runs longer
const JS_SPLIT_MAX = 160 * 1024 * 1024 // the pure-JS MP3 split holds the file in RAM

// Quality ladder for very long recordings: 48k fits ~3h, 32k ~4h, then 24k/16k
// cover the rare marathon files. Speech stays perfectly transcribable.
const PASSES: [number, string][] = [
  [24000, '48k'],
  [16000, '32k'],
  [16000, '24k'],
  [16000, '16k'],
]

// ---------------------------------------------------------------------------
// 1) Pure-JS MP3 frame splitter — no wasm, no network, runs in milliseconds.
// Every MP3 frame carries its own header (sync word, bitrate, sample rate,
// padding), so frames are self-delimiting and the stream can be cut between
// frames without touching a single byte of audio.
const MP3_BITRATES_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const MP3_BITRATES_V1L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384]
const MP3_BITRATES_V1L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448]
const MP3_BITRATES_LSF = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const MP3_SR_V1 = [44100, 48000, 32000]
const MP3_SR_V2 = [22050, 24000, 16000]
const MP3_SR_V25 = [11025, 12000, 8000]

// Length of the ID3v2 tag prefix, if any (sync-safe size in bytes 6..9).
function id3v2Size(b: Uint8Array): number {
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const sz = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
    return Math.min(b.length, 10 + sz)
  }
  return 0
}

// Frame length at offset i, or 0 when the header is not a plausible MP3 frame.
function mp3FrameLen(b: Uint8Array, i: number): number {
  if (i + 4 > b.length) return 0
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return 0
  const ver = (b[i + 1] >> 3) & 3 // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=reserved
  const layer = (b[i + 1] >> 1) & 3 // 1=III, 2=II, 3=I, 0=reserved
  const brIdx = (b[i + 2] >> 4) & 0xf
  const srIdx = (b[i + 2] >> 2) & 3
  const pad = (b[i + 2] >> 1) & 1
  if (ver === 1 || layer === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) return 0
  const v1 = ver === 3
  // layer bits: 1 = Layer III, 2 = Layer II, 3 = Layer I
  const brTab = v1 ? (layer === 1 ? MP3_BITRATES_V1L3 : layer === 2 ? MP3_BITRATES_V1L2 : MP3_BITRATES_V1L1) : MP3_BITRATES_LSF
  const srTab = v1 ? MP3_SR_V1 : ver === 2 ? MP3_SR_V2 : MP3_SR_V25
  const br = brTab[brIdx] * 1000
  const sr = srTab[srIdx]
  if (!br || !sr) return 0
  let len: number
  if (layer === 1) len = Math.floor((v1 ? 144 : 72) * br / sr) + pad
  else if (layer === 2) len = Math.floor(144 * br / sr) + pad
  else len = (Math.floor(12 * br / sr) + pad) * 4
  // sanity: real audio frames are tens to ~1500 bytes; anything else is a
  // false sync inside garbage/cover art — resync from the next byte.
  if (len < 16 || len > 2048) return 0
  return len
}

// exported for the node test harness (scripts/test_split_mp3.js)
export async function splitMp3InJs(input: File): Promise<File[]> {
  // Read once for scanning; the output parts are cheap views over the same
  // bytes (Blob.slice does not copy), so peak memory stays ~1x the file.
  const b = new Uint8Array(await input.arrayBuffer())
  const start = id3v2Size(b)
  const cuts: number[] = [start]
  let acc = 0
  let i = start
  while (i < b.length - 4) {
    const len = mp3FrameLen(b, i)
    if (len) {
      if (acc + len > COPY_TARGET && i > cuts[cuts.length - 1]) {
        cuts.push(i)
        acc = len
      } else {
        acc += len
      }
      i += len
    } else {
      i++
    }
  }
  const parts: File[] = []
  const base = input.name.replace(/\.mp3$/i, '')
  for (let k = 0; k < cuts.length; k++) {
    const from = cuts[k]
    const to = k + 1 < cuts.length ? cuts[k + 1] : b.length
    if (to - from < 1024) continue // trailing junk sliver
    parts.push(new File([input.slice(from, to)], `${base} (${k + 1}-${cuts.length}).mp3`, { type: 'audio/mpeg' }))
  }
  return parts
}

// ---------------------------------------------------------------------------
// 2) ffmpeg.wasm lossless copy split (-c copy): instant, no re-encoding.
// Used for non-MP3 audio (m4a…) and as a rescue for anything the other
// strategies could not handle.
async function probeDuration(ff: FFmpegLike, inPath: string): Promise<number> {
  let dur = 0
  const onLog = (e: { type: string; message: string }) => {
    if (dur) return
    const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(e.message)
    if (m) dur = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  }
  ff.on('log', onLog)
  try {
    await Promise.race([ff.exec(['-i', inPath]), sleep(15000)])
  } finally {
    ff.off('log', onLog)
  }
  return dur
}

async function copySplitFf(
  ff: FFmpegLike,
  inPath: string,
  ext: string,
  mime: string,
  size: number,
  base: string,
  onProgress: (pct: number) => void,
): Promise<File[] | null> {
  // unique per-call tag: /rn-out may hold leftovers from an earlier upload in
  // the same session, so this run only ever picks up its own seg files
  const tag = `sg${Date.now().toString(36)}`
  const segRe = new RegExp(`^${tag}\\d+\\.${ext}$`)
  const dur = await probeDuration(ff, inPath)
  let segT = dur > 0 ? Math.max(60, Math.floor(COPY_TARGET / (size / dur))) : 3600
  for (let attempt = 0; attempt < 3; attempt++) {
    const pat = `/rn-out/${tag}%03d.${ext}`
    const code = await ff.exec([
      '-i', inPath, '-f', 'segment', '-segment_time', String(segT),
      '-reset_timestamps', '1', '-c', 'copy', '-y', pat,
    ])
    const names = (await ff.listDir('/rn-out'))
      .filter((e) => !e.isDir && segRe.test(e.name))
      .map((e) => e.name)
      .sort()
    const parts: File[] = []
    let tooBig = false
    if (code === 0 && names.length >= 2) {
      for (let k = 0; k < names.length; k++) {
        onProgress(30 + Math.round((k / names.length) * 60))
        const d = await ff.readFile(`/rn-out/${names[k]}`)
        const u8 = typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d)
        if (u8.byteLength > HARD_LIMIT) {
          tooBig = true
          break
        }
        if (u8.byteLength > 1024) {
          const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
          parts.push(new File([buf], `${base} (${k + 1}-${names.length}).${ext}`, { type: mime }))
        }
      }
      if (!tooBig && parts.length >= 2) return parts
    }
    // clean up and try again with smaller parts
    for (const n of names) {
      try {
        await ff.deleteFile(`/rn-out/${n}`)
      } catch {
        /* best-effort */
      }
    }
    if (tooBig && dur > 0 && segT <= 60) break
    segT = Math.max(30, Math.floor(segT / 2))
  }
  return null
}

// ---------------------------------------------------------------------------
// 3) The re-encode ladder: video becomes audio-only; stubborn audio is
// recompressed to a compact mono MP3 the AI transcribes just as well.
async function recompressFf(
  ff: FFmpegLike,
  inPath: string,
  input: File,
  wasVideo: boolean,
  onProgress: (pct: number) => void,
): Promise<CompressResult> {
  const OUT = '/rn-out/rn.mp3'
  const args = (ar: number, br: string) => [
    '-i', inPath, '-vn', '-ac', '1', '-ar', String(ar),
    '-c:a', 'libmp3lame', '-b:a', br, '-y', OUT,
  ]
  const runPass = async (ar: number, br: string) => {
    const res = await Promise.race([
      ff.exec(args(ar, br)).then((code) => ({ ok: true as const, code })),
      sleep(PASS_TIMEOUT).then(() => ({ ok: false as const })),
    ])
    if (!res.ok) throw new Error('compression timed out')
  }
  let u8: Uint8Array | null = null
  for (const [ar, br] of PASSES) {
    onProgress(0)
    await runPass(ar, br)
    const d = await ff.readFile(OUT)
    const cur = typeof d === 'string' ? new TextEncoder().encode(d) : new Uint8Array(d)
    if (cur.byteLength > 1024) u8 = new Uint8Array(cur) // copy out of wasm memory
    if (u8 && (u8.byteLength <= TARGET || br === PASSES[PASSES.length - 1][1])) break
  }
  if (!u8 || u8.byteLength <= 1024) throw new Error('empty output')
  if (u8.byteLength > HARD_LIMIT) throw new Error('still-too-big')
  if (u8.byteLength >= input.size) return { files: [input], note: null } // no gain, keep the original
  const outName = `${input.name.replace(/\.[^.]+$/, '')}.mp3`
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
  const out = new File([buf], outName, { type: 'audio/mpeg' })
  return { files: [out], note: wasVideo ? 'audio-only' : 'recompressed' }
}

const isAudioOnly = (f: File) =>
  f.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus|wma|amr)$/i.test(f.name)

export async function compressMedia(
  input: File,
  onProgress: (pct: number) => void,
  onStage: (s: Stage) => void,
): Promise<CompressResult> {
  const wasVideo = input.type.startsWith('video/')
  const audioOnly = isAudioOnly(input)
  const base = input.name.replace(/\.[^.]+$/, '')
  let lastReason = 'unknown'
  let onProg: ((e: { progress: number }) => void) | null = null

  // 1) MP3: split in pure JS first — instant, and it never needs the 31MB
  // engine download, so it works even where ffmpeg.wasm cannot load.
  if (/\.mp3$/i.test(input.name) && input.size <= JS_SPLIT_MAX) {
    try {
      onStage('split')
      onProgress(10)
      const parts = await splitMp3InJs(input)
      if (parts.length >= 2) {
        onProgress(99)
        return { files: parts, note: 'split' }
      }
    } catch (e) {
      lastReason = e instanceof Error ? e.message : 'js-split-failed'
    }
  }

  const ff = await getEngine(onStage)
  const DIR_IN = '/rn-in'
  try {
    for (const d of [DIR_IN, '/rn-out']) {
      try {
        await ff.createDir(d)
      } catch {
        /* already exists */
      }
    }
    // WORKERFS streams straight from the File on disk: 1GB never enters memory.
    await ff.mount('WORKERFS', { files: [input] }, DIR_IN)
    const entries = (await ff.listDir(DIR_IN)).filter((e) => !e.isDir && e.name !== '.' && e.name !== '..')
    const inName = entries[0]?.name
    if (!inName) throw new Error('input not mounted')
    const inPath = `${DIR_IN}/${inName}`
    const ext = (input.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3'
    const mime = input.type || 'application/octet-stream'
    onProg = (e: { progress: number }) =>
      onProgress(Math.max(0, Math.min(99, Math.round(e.progress * 100))))
    ff.on('progress', onProg)

    // 2) audio (non-mp3, or mp3 the JS splitter could not handle): lossless
    //    stream-copy split first — seconds instead of hours.
    if (audioOnly) {
      try {
        onStage('split')
        onProgress(10)
        const parts = await copySplitFf(ff, inPath, ext, mime, input.size, base, onProgress)
        if (parts) {
          onProgress(99)
          return { files: parts, note: 'split' }
        }
      } catch (e) {
        lastReason = e instanceof Error ? e.message : 'copy-split-failed'
      }
    }

    // 3) re-encode ladder (video → audio-only; audio fallback)
    try {
      const r = await recompressFf(ff, inPath, input, wasVideo, onProgress)
      return r
    } catch (e) {
      lastReason = e instanceof Error ? e.message : 'recompress-failed'
    }

    // 4) last resort: lossless split even for video (many small sources beat
    //    a failed upload)
    try {
      onStage('split')
      onProgress(10)
      const parts = await copySplitFf(ff, inPath, ext, mime, input.size, base, onProgress)
      if (parts) {
        onProgress(99)
        return { files: parts, note: 'split' }
      }
    } catch (e) {
      lastReason = e instanceof Error ? e.message : 'copy-split-failed'
    }

    throw new Error(`compress-failed: ${lastReason}`)
  } finally {
    if (onProg) ff.off('progress', onProg)
    onProgress(100)
    for (const fn of [() => ff.unmount(DIR_IN), () => ff.deleteDir(DIR_IN), () => ff.deleteDir('/rn-out')]) {
      try {
        await fn()
      } catch {
        /* cleanup best-effort */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Big PDFs: the storage plan caps every stored object (~50MB), so a large PDF
// is split IN THE BROWSER into several smaller PDFs, each uploaded as its own
// source. Pages are copied verbatim — nothing is re-encoded, no quality is
// lost, and each part still has its text layer. pdf-lib is imported lazily so
// the ~1MB library is only downloaded when a big PDF is actually dropped.
const PDF_TARGET = 40 * 1024 * 1024 // aim well under the 50MB storage cap
const PDF_HARD = 46 * 1024 * 1024 // a single part above this is not usable
const SPLIT_MAX = 300 * 1024 * 1024 // bigger inputs can exhaust phone memory

export const looksLikePdf = (f: File) =>
  f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

export const looksLikeImage = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|heic|heif|tiff?)$/i.test(f.name)

export async function splitPdf(
  input: File,
  onStage: () => void,
  onProgress: (part: number, total: number) => void,
): Promise<File[]> {
  if (input.size > SPLIT_MAX) throw new Error('pdf-too-large-to-split')
  onStage()
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(await input.arrayBuffer(), { ignoreEncryption: true })
  const pages = src.getPageCount()
  if (pages < 2) throw new Error('page-too-big') // one huge page cannot be split further
  const base = input.name.replace(/\.pdf$/i, '')
  let n = Math.max(2, Math.ceil(input.size / PDF_TARGET))
  for (let attempt = 0; attempt < 3; attempt++) {
    const per = Math.ceil(pages / n)
    const ranges: { start: number; count: number }[] = []
    for (let s = 0; s < pages; s += per) ranges.push({ start: s, count: Math.min(per, pages - s) })
    const out: File[] = []
    let retry = false
    for (let i = 0; i < ranges.length; i++) {
      onProgress(i + 1, ranges.length)
      const doc = await PDFDocument.create()
      const copied = await doc.copyPages(src, Array.from({ length: ranges[i].count }, (_, k) => ranges[i].start + k))
      for (const p of copied) doc.addPage(p)
      const bytes = await doc.save({ useObjectStreams: true })
      if (bytes.byteLength > PDF_HARD) {
        if (ranges[i].count === 1) throw new Error('page-too-big')
        retry = true
        break
      }
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      out.push(new File([buf], `${base} (${i + 1}-${ranges.length}).pdf`, { type: 'application/pdf' }))
    }
    if (!retry) return out
    n = Math.ceil(n * 1.6) + 1 // uneven page weights: try with more, smaller parts
  }
  throw new Error('split-failed')
}

// ---------------------------------------------------------------------------
// Big images: re-encode as JPEG (long edge capped at 4096px, plenty for slides
// and scans) stepping quality down until the result fits the storage cap.
export async function compressImage(input: File): Promise<File | null> {
  const bmp = await createImageBitmap(input)
  const scale = Math.min(1, 4096 / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const name = `${input.name.replace(/\.[^.]+$/, '')}.jpg`
  for (const q of [0.82, 0.6, 0.42, 0.28, 0.18]) {
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', q))
    if (blob && blob.size <= PDF_HARD) return new File([blob], name, { type: 'image/jpeg' })
  }
  return null
}
