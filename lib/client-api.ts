export class ApiError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

export type Resp = {
  error?: string
  code?: string
  total?: number
  done?: number[]
  ended?: boolean
  retry?: boolean
  id?: string
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function mediaDuration(url: string, video: boolean): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(video ? 'video' : 'audio')
    const finish = (n: number) => {
      el.removeAttribute('src')
      resolve(Number.isFinite(n) ? n : 0)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => finish(el.duration)
    el.onerror = () => finish(0)
    setTimeout(() => finish(0), 10000)
    el.src = url
  })
}

// Retries network drops, empty 5xx replies and the server's "switch key and retry" signal.
export async function postJson(url: string, body: object): Promise<Resp> {
  let last = new ApiError('', 'timeout')
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => null)) as Resp | null
      if (r.ok) return j ?? {}
      if (j?.retry) {
        last = new ApiError(j.error ?? '', 'retry')
        await sleep(800)
        continue
      }
      if (j?.error) throw new ApiError(j.error, j.code ?? 'other')
      last = new ApiError('', 'timeout')
    } catch (e) {
      if (!(e instanceof TypeError)) throw e
      last = new ApiError('', 'other')
    }
    await sleep(1500 * (attempt + 1))
  }
  throw last
}
