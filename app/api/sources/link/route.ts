import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

// Basic protection against the server being used to reach private addresses.
function safeUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.port && u.port !== '80' && u.port !== '443') return null
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':')) return null
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return null
    }
  }
  return u
}

function youtubeId(u: URL): string | null {
  const h = u.hostname.replace(/^www\./, '').replace(/^m\./, '')
  if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
  if (h === 'youtube.com') {
    if (u.pathname === '/watch') return u.searchParams.get('v')
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/)
    return m ? m[1] : null
  }
  return null
}

function htmlToText(html: string) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim()
  let t = html.replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)[\s\S]*?<\/\1>/gi, ' ')
  t = t.replace(/<\/(p|div|h[1-6]|li|tr|section|article)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  t = t
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
  t = t.replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { title, text: t }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const userId = claims?.claims?.sub
    if (!userId) return fail('Please log in again.', 401)

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const subjectId = String(body.subjectId ?? '')
    if (!UUID.test(subjectId)) return fail('Invalid subject')
    const url = safeUrl(String(body.url ?? ''))
    if (!url) return fail('This link is not allowed. Use a normal http(s) address.')

    const { data: subject } = await supabase.from('subjects').select('id').eq('id', subjectId).single()
    if (!subject) return fail('Subject not found', 404)

    const id = crypto.randomUUID()
    const yt = youtubeId(url)

    if (yt) {
      const watch = `https://www.youtube.com/watch?v=${yt}`
      let title = 'YouTube video'
      try {
        const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`, {
          signal: AbortSignal.timeout(6000),
        })
        if (r.ok) title = ((await r.json()) as { title?: string }).title ?? title
      } catch {}
      const { error } = await supabase.from('files').insert({
        id, subject_id: subjectId, name: title.slice(0, 160), storage_path: `link:${id}`,
        mime: 'video/youtube', size_bytes: 0, source_url: watch,
      })
      if (error) return fail(error.message, 500)
      return NextResponse.json({ ok: true, id })
    }

    let html: string
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; RyanNotes/1.0)', accept: 'text/html,text/plain' },
      })
      if (!r.ok) return fail(`The website answered with HTTP ${r.status}.`, 422)
      const ct = r.headers.get('content-type') ?? ''
      if (!/text\/(html|plain)/i.test(ct)) return fail('Only web pages and text are supported for now.', 422)
      html = (await r.text()).slice(0, 2_000_000)
    } catch {
      return fail('Could not open this website.', 422)
    }

    const { title, text } = htmlToText(html)
    if (text.length < 200) return fail('Could not read enough text from this page.', 422)
    const name = (title || url.hostname).slice(0, 160)
    const content = `# ${name}\n\n(${url.toString()})\n\n${text}`.slice(0, 400_000)
    const bytes = new TextEncoder().encode(content)
    const path = `${userId}/${subjectId}/${id}-link.txt`

    const { error: upErr } = await supabase.storage
      .from('lecture-files')
      .upload(path, bytes, { contentType: 'text/plain; charset=utf-8', upsert: false })
    if (upErr) return fail(upErr.message, 500)
    const { error } = await supabase.from('files').insert({
      id, subject_id: subjectId, name, storage_path: path, mime: 'text/plain',
      size_bytes: bytes.length, source_url: url.toString(),
    })
    if (error) {
      await supabase.storage.from('lecture-files').remove([path])
      return fail(error.message, 500)
    }
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
}
