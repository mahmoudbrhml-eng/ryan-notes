import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPlanStatus } from '@/lib/plans'

export const dynamic = 'force-dynamic'

// The signed-in user's plan + today's usage. One source for the client bits
// (upload size cap, plan badge) — the same status the /plan page shows and the
// Telegram bot enforces, so every surface stays mirrored.
export async function GET() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const status = await getPlanStatus(supabase)
  if (!status) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  return NextResponse.json(status)
}
