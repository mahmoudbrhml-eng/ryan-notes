// Split-part naming: when a file is too big for storage it is cut in the
// browser into several parts named "Lecture name (1-3).mp3", "(2-3)", "(3-3)".
// These helpers recognize such groups so the app can treat the parts as ONE
// lecture again (ordered transcript merge, context across part seams).

export type PartInfo = { base: string; idx: number; total: number }

export function parsePartName(name: string): PartInfo | null {
  const stem = name.replace(/\.[^.]+$/, '')
  const m = /^(.*) \((\d+)-(\d+)\)$/.exec(stem)
  if (!m) return null
  const base = m[1].trim()
  const idx = Number(m[2])
  const total = Number(m[3])
  if (!base || !idx || !total || idx < 1 || idx > total || total < 2 || total > 99) return null
  return { base, idx, total }
}

// A group of file names forms one lecture when every name parses as a part,
// they share the same base and total, and the indices cover 1..total exactly.
// Returns the names ordered by part index, or null when this is not a group.
export function matchPartGroup(names: string[]): { base: string; total: number; ordered: string[] } | null {
  if (names.length < 2) return null
  const parsed = names.map((n) => ({ n, p: parsePartName(n) }))
  if (parsed.some((x) => !x.p)) return null
  const base = parsed[0].p!.base
  const total = parsed[0].p!.total
  if (parsed.some((x) => x.p!.base !== base || x.p!.total !== total)) return null
  const seen = new Set(parsed.map((x) => x.p!.idx))
  if (seen.size !== names.length) return null // duplicate index
  for (let i = 1; i <= total; i++) if (!seen.has(i)) return null // gaps
  if (total !== names.length) return null // e.g. selected (1-3) and (2-3) twice is impossible, but (1-3) without (3-3) is caught above
  const ordered = parsed
    .sort((a, b) => a.p!.idx - b.p!.idx)
    .map((x) => x.n)
  return { base, total, ordered }
}
