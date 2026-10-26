export type FileKind = 'media' | 'text' | 'doc' | 'unsupported'

export function kindOf(name: string, mime: string | null): FileKind {
  const m = (mime ?? '').toLowerCase()
  const n = name.toLowerCase()
  if (/^(audio|video)\//.test(m) || /\.(mp3|m4a|wav|ogg|aac|flac|mp4|webm|mov|mkv)$/.test(n)) return 'media'
  if (/^text\//.test(m) || /\.(txt|md)$/.test(n)) return 'text'
  if (m === 'application/pdf' || /\.pdf$/.test(n) || /^image\//.test(m)) return 'doc'
  return 'unsupported'
}

export function mimeFor(name: string, mime: string | null): string {
  const m = (mime ?? '').toLowerCase()
  if (m && m !== 'application/octet-stream') return m === 'audio/x-m4a' || m === 'audio/m4a' ? 'audio/mp4' : m
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac',
    flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  }
  return map[ext] ?? 'application/octet-stream'
}
