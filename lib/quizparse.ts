// Shared quiz parsing — used by the quiz generator and the practice generator.
export type Q = { q: string; o: string[]; a: number; ex: string }

export function parseQuiz(raw: string): Q[] {
  const clean = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = clean.indexOf('[')
  const end = clean.lastIndexOf(']')
  if (start < 0 || end < 0) return []
  let arr: unknown
  try {
    arr = JSON.parse(clean.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: Q[] = []
  for (const x of arr as Record<string, unknown>[]) {
    const o = Array.isArray(x.o) ? x.o.map((s) => String(s)) : []
    const a = Number(x.a)
    if (typeof x.q === 'string' && o.length === 4 && Number.isInteger(a) && a >= 0 && a <= 3) {
      out.push({ q: x.q, o, a, ex: typeof x.ex === 'string' ? x.ex : '' })
    }
  }
  return out
}
