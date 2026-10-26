// Collects the "> ⭐️ Doctor's Focus: ..." lines the transcription prompt asks the model to write.
export function extractFocus(md: string): string[] {
  const items: string[] = []
  let cur: string | null = null
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    const m = line.match(/^>\s*(?:⭐\uFE0F?\s*)?Doctor['’]?s Focus:?\s*(.*)$/i)
    if (m) {
      if (cur) items.push(cur)
      cur = m[1].trim()
    } else if (cur !== null && line.startsWith('>')) {
      const more = line.replace(/^>\s*/, '').trim()
      if (more) cur += ' ' + more
    } else if (cur !== null) {
      if (cur) items.push(cur)
      cur = null
    }
  }
  if (cur) items.push(cur)
  return items.filter(Boolean)
}
