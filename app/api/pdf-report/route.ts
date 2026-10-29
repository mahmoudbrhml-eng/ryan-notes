import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Receives one tiny report per PDF download attempt (engine used, page count,
// output completeness, device). Lets the admin see exactly what happened on a
// user's device instead of guessing. Fails silent — telemetry only.
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const uid = claims?.claims?.sub
    if (!uid) return NextResponse.json({ ok: true })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
    await supabase.from('pdf_renders').insert({
      user_id: uid,
      doc: String(b.doc ?? 'unknown').slice(0, 20),
      mode: b.mode === 'fallback' ? 'fallback' : 'paged',
      pages: num(b.pages),
      src_len: num(b.srcLen),
      out_len: num(b.outLen),
      ms: num(b.ms),
      ok: b.ok === true,
      err: typeof b.err === 'string' ? b.err.slice(0, 160) : null,
      ua: (req.headers.get('user-agent') ?? '').slice(0, 180),
    })
  } catch {
    /* never let telemetry break anything */
  }
  return NextResponse.json({ ok: true })
}
