// Deterministic markdown clean-up applied to every AI result before it is stored or shown.
export function cleanMarkdown(input: string): string {
  let t = input.replace(/\r\n?/g, '\n').trim()
  const fence = t.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i)
  if (fence) t = fence[1]
  t = t
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^[ \t]*[•●▪◦]\s+/gm, '- ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\u00A0/g, ' ')
    .replace(/ +([،؛؟!,;?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
  t = t.replace(/([^\n])\n(#{1,4} )/g, '$1\n\n$2').replace(/^(#{1,4} .*)\n([^\n#])/gm, '$1\n\n$2')
  const out: string[] = []
  let lastHead = ''
  for (const l of t.split('\n')) {
    if (/^#{1,4} /.test(l)) {
      if (l.trim() === lastHead) continue
      lastHead = l.trim()
    } else if (l.trim()) lastHead = ''
    out.push(l)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function sliceText(md: string, size: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const p of md.split(/\n{2,}/)) {
    if (cur && cur.length + p.length > size) {
      out.push(cur)
      cur = ''
    }
    cur += p + '\n\n'
  }
  if (cur.trim()) out.push(cur)
  return out
}

// Evenly spaced windows so a very long lecture still fits one request.
export function sampleText(md: string, limit: number): string {
  if (md.length <= limit) return md
  const n = 4
  const w = Math.floor(limit / n)
  const step = Math.floor((md.length - w) / (n - 1))
  return Array.from({ length: n }, (_, i) => md.slice(i * step, i * step + w)).join('\n\n[...]\n\n')
}
