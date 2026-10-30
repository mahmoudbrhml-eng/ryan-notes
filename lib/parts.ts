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

// ---------------------------------------------------------------------------
// Hidden multi-part sources: a split upload is ONE `files` row whose `parts`
// jsonb holds every storage object (part 0 = the row's own storage_path).
// The user only ever sees one record; the parts exist purely behind the scenes.
export type FilePart = { path: string; name: string; size: number; dur?: number; pages?: number }

// Chunk planning: each part contributes its own chunks (audio: ceil(dur/SEG),
// PDF: ceil(pages/PAGES)) and the global chunk index maps deterministically to
// [part, local chunk inside that part]. counts[p] must be >= 1.
export function planChunks(counts: number[]): { part: number; local: number }[] {
  const out: { part: number; local: number }[] = []
  for (let p = 0; p < counts.length; p++) {
    const n = Math.max(1, Math.ceil(counts[p]))
    for (let j = 0; j < n; j++) out.push({ part: p, local: j })
  }
  return out
}

// Legacy rows carry no per-part durations. Distribute a known total duration
// across parts proportionally to their bytes (same recording => same bitrate),
// or fall back to a 128 kbps estimate when even the total is unknown.
export function spreadDuration(total: number, sizes: number[]): number[] {
  if (total > 0 && sizes.length > 0 && sizes.every((s) => s > 0)) {
    const sum = sizes.reduce((a, b) => a + b, 0)
    return sizes.map((s) => (total * s) / sum)
  }
  return sizes.map((s) => (s > 0 ? s / 16000 : 600)) // ~128 kbps bytes/sec
}
