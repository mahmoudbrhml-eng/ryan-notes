import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Client-side failure telemetry for the upload pipeline: the browser sends the
// real error text (compression, split, storage) so device-specific failures
// can be diagnosed without guessing. Fire-and-forget; never blocks an upload.
export const maxDuration = 15

const STAGES = new Set([
  'compress-failed', 'split-failed', 'image-failed', 'storage-rejected', 'db-failed', 'too-big', 'other',
])
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: claims } = await supabase.auth.getClaims()
    const uid = claims?.claims?.sub
    if (!uid) return new NextResponse(null, { status: 204 })

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const stage = typeof b.stage === 'string' && STAGES.has(b.stage) ? b.stage : 'other'
    await supabase.from('upload_errors').insert({
      user_id: uid,
      file_name: clean(b.name, 200),
      file_size: typeof b.size === 'number' && Number.isFinite(b.size) ? Math.round(b.size) : null,
      file_mime: clean(b.mime, 120),
      stage,
      message: clean(b.message, 800),
    })
  } catch {
    /* telemetry must never surface as a user-facing error */
  }
  return new NextResponse(null, { status: 204 })
}
