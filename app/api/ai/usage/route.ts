import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPlanStatus } from '@/lib/plans'

export const dynamic = 'force-dynamic'

// Today's AI consumption for the signed-in user, broken down per feature, plus
// the last 7 days' totals. RLS on ai_usage_daily only ever returns own rows.
// The limit shown is the user's plan limit (sql/10_plans.sql), not a global cap.
export async function GET() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const today = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10)

  const [{ data: todayRows }, { data: weekRows }, plan] = await Promise.all([
    supabase.from('ai_usage_daily').select('feature, calls').eq('day', today),
    supabase.from('ai_usage_daily').select('day, calls').gte('day', weekAgo),
    getPlanStatus(supabase),
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
    limit: plan?.callsLimit ?? Number(process.env.AI_DAILY_LIMIT ?? 400),
    total,
    features,
    week,
    plan: plan?.plan ?? 'free',
    tokensUsed: plan?.tokensUsed ?? 0,
    tokensLimit: plan?.tokensLimit ?? null,
    uploadMB: plan?.uploadMB ?? 20,
  })
}
