'use client'

// Client-side compression for large media files (up to 1GB) using ffmpeg.wasm.
// - The engine is served from THIS site first (/public/ffmpeg), so it works even
//   when public CDNs are blocked or slow. CDN copies remain as fallbacks.
// - The input file is mounted with WORKERFS and streamed, so even a 1GB file
//   never has to fit into memory.
// - Output is a compact mono MP3, which the AI transcribes just as well as the
//   original. Lower-quality passes run automatically until the file fits.

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
  listDir(path: string): Promise<{ name: string; isDir: boolean }[]>
  readFile(path: string): Promise<Uint8Array | string>
  on(evt: 'progress', cb: (e: { progress: number; time?: number }) => void): void
  off(evt: 'progress', cb: (e: { progress: number; time?: number }) => void): void
}

declare global {
  interface Window {
    FFmpegWASM?: { FFmpeg: new () => FFmpegLike }
    FFmpegUtil?: { toBlobURL: (url: string, type: string) => Promise<string> }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function loadScript(src: string): Promise<void> {
  return new Promise((ok, err) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => ok()
    s.onerror = () => err(new Error(`failed to load ${src}`))
    document.head.appendChild(s)
  })
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

function getEngine(onStage?: (s: 'engine') => void): Promise<FFmpegLike> {
  if (!engine) {
    engine = (async () => {
      onStage?.('engine')
      await firstOK(FFMPEG_BASES, 'ffmpeg.js', loadScript)
      if (!window.FFmpegWASM) throw new Error('ffmpeg global missing')
      await firstOK(UTIL_BASES, 'util.js', loadScript)
      if (!window.FFmpegUtil) throw new Error('util global missing')
      const { toBlobURL } = window.FFmpegUtil
      const ff = new window.FFmpegWASM.FFmpeg()
      const [coreURL, wasmURL] = await Promise.all([
        firstOK(CORE_BASES, 'ffmpeg-core.js', (u) => toBlobURL(u, 'text/javascript')),
        firstOK(CORE_BASES, 'ffmpeg-core.wasm', (u) => toBlobURL(u, 'application/wasm')),
      ])
      const classWorkerURL = await firstOK(FFMPEG_BASES, '814.ffmpeg.js', (u) => toBlobURL(u, 'text/javascript'))
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

export type CompressResult = { file: File; note: 'audio-only' | 'recompressed' | null }

const TARGET = 45 * 1024 * 1024 // aim below this to stay safely under the 50MB bucket limit
const HARD_LIMIT = 49 * 1024 * 1024 // above this we refuse: the bucket itself rejects >50MB
const PASS_TIMEOUT = 20 * 60 * 1000 // a single pass never runs longer than 20 minutes

// Quality ladder for very long recordings: 48k fits ~3h, 32k ~4h, then 24k/16k
// cover the rare marathon files. Speech stays perfectly transcribable.
const PASSES: [number, string][] = [
  [24000, '48k'],
  [16000, '32k'],
  [16000, '24k'],
  [16000, '16k'],
]

export async function compressMedia(
  input: File,
  onProgress: (pct: number) => void,
  onStage: (s: 'engine') => void,
): Promise<CompressResult> {
  const ff = await getEngine(onStage)
  const DIR_IN = '/rn-in'
  const DIR_OUT = '/rn-out'
  const OUT = `${DIR_OUT}/rn.mp3`
  const wasVideo = input.type.startsWith('video/')
  const onProg = (e: { progress: number }) =>
    onProgress(Math.max(0, Math.min(99, Math.round(e.progress * 100))))
  ff.on('progress', onProg)
  try {
    for (const d of [DIR_IN, DIR_OUT]) {
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

    const args = (ar: number, br: string) => [
      '-i', `${DIR_IN}/${inName}`, '-vn', '-ac', '1', '-ar', String(ar),
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
    if (u8.byteLength >= input.size) return { file: input, note: null } // no gain, keep the original

    const outName = `${input.name.replace(/\.[^.]+$/, '')}.mp3`
    const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
    const out = new File([buf], outName, { type: 'audio/mpeg' })
    return { file: out, note: wasVideo ? 'audio-only' : 'recompressed' }
  } finally {
    ff.off('progress', onProg)
    onProgress(100)
    for (const fn of [() => ff.unmount(DIR_IN), () => ff.deleteDir(DIR_IN), () => ff.deleteDir(DIR_OUT)]) {
      try {
        await fn()
      } catch {
        /* cleanup best-effort */
      }
    }
  }
}
