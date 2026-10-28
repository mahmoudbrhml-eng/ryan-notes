const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'which', 'are', 'was', 'were', 'how', 'why', 'when',
  'هو', 'هي', 'في', 'على', 'من', 'ده', 'دي', 'ايه', 'ازاي', 'عن', 'مع', 'ان', 'هل', 'ما', 'ماذا', 'لما', 'اللي', 'يعني',
])

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
}
const tokens = (s: string) => (norm(s).match(/[a-z0-9\u0600-\u06FF]{3,}/g) ?? []).filter((w) => !STOP.has(w))

type Doc = { title: string; content: string }

// Returns the whole material when it is small, otherwise the passages that best match the question.
export function pickRelevant(docs: Doc[], query: string, budget: number): string {
  const total = docs.reduce((n, d) => n + d.content.length, 0)
  if (total <= budget) return docs.map((d) => `### Lecture: ${d.title}\n${d.content}`).join('\n\n')

  const q = new Set(tokens(query))
  type Chunk = { d: number; i: number; text: string; score: number }
  const chunks: Chunk[] = []
  docs.forEach((d, di) => {
    let cur = ''
    let idx = 0
    const flush = () => {
      if (!cur.trim()) return
      const tk = new Set(tokens(cur))
      let hits = 0
      q.forEach((w) => tk.has(w) && hits++)
      chunks.push({ d: di, i: idx++, text: cur, score: hits / Math.sqrt(cur.length / 1000 + 1) })
      cur = ''
    }
    for (const p of d.content.split(/\n{2,}/)) {
      if (cur && cur.length + p.length > 1500) flush()
      cur += p + '\n\n'
    }
    flush()
  })

  const chosen = new Set<Chunk>()
  let used = 0
  for (const c of chunks.filter((x) => x.i === 0)) {
    chosen.add(c)
    used += c.text.length
  }
  for (const c of [...chunks].sort((a, b) => b.score - a.score)) {
    if (used >= budget) break
    if (c.score <= 0 || chosen.has(c)) continue
    chosen.add(c)
    used += c.text.length
  }
  return [...chosen]
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((c) => `### Lecture: ${docs[c.d].title}\n${c.text}`)
    .join('\n\n')
}
