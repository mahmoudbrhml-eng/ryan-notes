import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ITEMS = 300
const MAX_BYTES = 120_000 // per page — pen strokes are tiny, this is abuse cover

type Item = Record<string, unknown>

function saneItems(raw: unknown): Item[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) return null
  const out: Item[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return null
    const o = it as Item
    const kind = o.kind
    if (kind !== 'pen' && kind !== 'hl' && kind !== 'note') return null
    if (typeof o.color !== 'string' || o.color.length > 20) return null
    if (kind === 'pen' && !Array.isArray(o.pts)) return null
    if (kind === 'note' && typeof o.text !== 'string') return null
    out.push(o)
  }
  return out
}

// Annotations for one PDF file, owned by the signed-in user (RLS enforces it).
export async function GET(req: Request) {
  const fileId = new URL(req.url).searchParams.get('fileId') ?? ''
  if (!UUID.test(fileId)) return NextResponse.json({ error: 'Invalid file' }, { status: 400 })

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // The file must be one the user can actually see (files RLS applies here).
  const { data: file } = await supabase.from('files').select('id').eq('id', fileId).maybeSingle()
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('pdf_notes')
    .select('page, items')
    .eq('file_id', fileId)
    .order('page')
  if (error) return NextResponse.json({ error: 'unavailable' }, { status: 503 })

  const pages: Record<string, Item[]> = {}
  for (const r of data ?? []) pages[String(r.page)] = (r.items as Item[]) ?? []
  return NextResponse.json({ pages })
}

// Replace ONE page's annotations (the reader saves a whole page per call).
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as
    { fileId?: string; page?: number; items?: unknown } | null
  const fileId = String(body?.fileId ?? '')
  const page = Number(body?.page)
  if (!UUID.test(fileId)) return NextResponse.json({ error: 'Invalid file' }, { status: 400 })
  if (!Number.isInteger(page) || page < 1 || page > 5000) {
    return NextResponse.json({ error: 'Invalid page' }, { status: 400 })
  }
  const items = saneItems(body?.items)
  if (items == null) return NextResponse.json({ error: 'Invalid annotations' }, { status: 400 })
  if (JSON.stringify(items).length > MAX_BYTES) {
    return NextResponse.json({ error: 'Too many annotations on one page' }, { status: 413 })
  }

  const { error } = await supabase.from('pdf_notes').upsert(
    { user_id: claims.claims.sub, file_id: fileId, page, items, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,file_id,page' },
  )
  if (error) return NextResponse.json({ error: 'Could not save annotations' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Clear one page (?fileId=&page=) or the whole document (?fileId=).
export async function DELETE(req: Request) {
  const sp = new URL(req.url).searchParams
  const fileId = sp.get('fileId') ?? ''
  if (!UUID.test(fileId)) return NextResponse.json({ error: 'Invalid file' }, { status: 400 })

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const page = Number(sp.get('page'))
  let q = supabase.from('pdf_notes').delete().eq('file_id', fileId)
  if (Number.isInteger(page) && page >= 1) q = q.eq('page', page)
  const { error } = await q
  if (error) return NextResponse.json({ error: 'Could not clear annotations' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
