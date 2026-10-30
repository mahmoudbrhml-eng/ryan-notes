import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Today's AI consumption for the signed-in user, broken down per feature, plus
// the last 7 days' totals. RLS on ai_usage_daily only ever returns own rows.
export async function GET() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10)

  const [{ data: todayRows }, { data: weekRows }] = await Promise.all([
    supabase.from('ai_usage_daily').select('feature, calls').eq('day', today),
    supabase.from('ai_usage_daily').select('day, calls').gte('day', weekAgo),
  ])

  const features: Record<string, number> = {}
  let total = 0
  for (const r of todayRows ?? []) {
    features[r.feature] = (features[r.feature] ?? 0) + r.calls
    total += r.calls
  }
  const week: Record<string, number> = {}
  for (const r of weekRows ?? []) week[r.day] = (week[r.day] ?? 0) + r.calls

  return NextResponse.json({
    limit: Number(process.env.AI_DAILY_LIMIT ?? 400),
    total,
    features,
    week,
  })
}
