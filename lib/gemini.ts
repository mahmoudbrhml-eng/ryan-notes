const G = 'https://generativelanguage.googleapis.com/'
const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-2.5-flash-lite']
const LIGHT_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.6-flash']

export class GeminiError extends Error {
  status: number
  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

export function apiKeys(): string[] {
  return (process.env.GEMINI_API_KEYS ?? process.env.GEMINI_API_KEY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function models(light: boolean): string[] {
  const env = (process.env.GEMINI_MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return env.length ? env : light ? LIGHT_MODELS : DEFAULT_MODELS
}

export function keyIndexFor(id: string, n: number): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return n > 0 ? h % n : 0
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type GFile = { name: string; uri: string; state: string }

// Uploads to the Gemini Files API. The returned uri only works with the same key that uploaded it.
export async function uploadFile(key: string, data: ArrayBuffer, mimeType: string, displayName: string) {
  const start = await fetch(`${G}upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(data.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  })
  const url = start.headers.get('x-goog-upload-url')
  if (!url) throw new GeminiError(`Could not start the upload to the AI service (HTTP ${start.status}).`, start.status)

  const up = await fetch(url, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: data,
  })
  if (!up.ok) throw new GeminiError(`Upload to the AI service failed (HTTP ${up.status}).`, up.status)

  let file = ((await up.json()) as { file: GFile }).file
  for (let i = 0; i < 20 && file.state === 'PROCESSING'; i++) {
    await sleep(2000)
    file = (await (await fetch(`${G}v1beta/${file.name}`, { headers: { 'x-goog-api-key': key } })).json()) as GFile
  }
  if (file.state !== 'ACTIVE') throw new GeminiError('The AI service could not process this file.', 500)
  return { uri: file.uri, name: file.name }
}

export type GeminiPart = { text: string } | { fileData: { mimeType: string; fileUri: string } }

type GenResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  error?: { message?: string }
}

export async function generate(
  parts: GeminiPart[],
  o: { light?: boolean; json?: boolean; max?: number; keyIndex?: number; pinned?: boolean; budgetMs?: number } = {}
): Promise<string> {
  const ks = apiKeys()
  if (ks.length === 0) throw new GeminiError('AI is not configured yet: add GEMINI_API_KEYS in Vercel.', 503)
  const order = o.pinned ? [o.keyIndex ?? 0] : ks.map((_, i) => i)
  const deadline = Date.now() + (o.budgetMs ?? 48000)
  let last = 'Unknown error'
  let quota = false

  for (const ki of order) {
    for (const m of models(!!o.light)) {
      if (Date.now() > deadline) throw new GeminiError('The AI took too long. Press Resume to try again.', 504)
      const gc: Record<string, unknown> = { maxOutputTokens: o.max ?? 16000 }
      if (o.json) gc.responseMimeType = 'application/json'
      if (m === 'gemini-2.5-flash') gc.thinkingConfig = { thinkingBudget: 0 }

      let r: Response
      try {
        r = await fetch(`${G}v1beta/models/${m}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': ks[ki], 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: gc }),
          signal: AbortSignal.timeout(Math.max(2000, deadline - Date.now())),
        })
      } catch (e) {
        last = e instanceof Error ? e.message : 'Network error'
        continue
      }
      const j = (await r.json().catch(() => ({}))) as GenResponse
      if (r.ok) {
        const t = (j.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? '').join('')
        if (t) return t
        last = 'Empty answer'
        continue
      }
      last = j.error?.message ?? `HTTP ${r.status}`
      if (r.status === 429) {
        quota = true
        continue
      }
      if (r.status === 404) continue
      if (r.status === 401 || r.status === 403 || (r.status === 400 && /API key/i.test(last))) break
    }
  }
  throw new GeminiError(
    quota ? 'AI quota is used up right now. Wait a few minutes and press Resume; your progress is saved.' : last,
    quota ? 429 : 500
  )
}
