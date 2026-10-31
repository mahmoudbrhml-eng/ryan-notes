// Plan limits — the single source of truth is sql/10_plans.sql (consume_quota
// / get_plan_status). Keep these numbers in sync with it. Pure data + types
// only: this file must stay importable from both server and client code.
import type { SupabaseClient } from '@supabase/supabase-js'

export type Plan = 'free' | 'plus' | 'pro' | 'max'
export const PLAN_ORDER: Plan[] = ['free', 'plus', 'pro', 'max']

export const PLANS: Record<Plan, { callsPerDay: number; tokensPerDay: number; uploadMB: number }> = {
  free: { callsPerDay: 5, tokensPerDay: 1_000_000, uploadMB: 20 },
  plus: { callsPerDay: 20, tokensPerDay: 4_000_000, uploadMB: 100 },
  pro: { callsPerDay: 100, tokensPerDay: 10_000_000, uploadMB: 500 },
  max: { callsPerDay: Infinity, tokensPerDay: Infinity, uploadMB: 2048 },
}

export type PlanStatus = {
  plan: Plan
  planExpiresAt: string | null
  callsUsed: number
  callsLimit: number | null // null = unlimited
  tokensUsed: number
  tokensLimit: number | null
  uploadMB: number
}

type RpcStatus = {
  ok?: boolean
  plan?: string
  plan_expires_at?: string | null
  calls_used?: number
  calls_limit?: number | null
  tokens_used?: number
  tokens_limit?: number | null
  upload_mb?: number
}

export function normalizeStatus(j: RpcStatus): PlanStatus {
  const plan = (j.plan && PLANS[j.plan as Plan] ? j.plan : 'free') as Plan
  return {
    plan,
    planExpiresAt: j.plan_expires_at ?? null,
    callsUsed: Number(j.calls_used ?? 0),
    callsLimit: j.calls_limit == null ? null : Number(j.calls_limit),
    tokensUsed: Number(j.tokens_used ?? 0),
    tokensLimit: j.tokens_limit == null ? null : Number(j.tokens_limit),
    uploadMB: Number(j.upload_mb ?? PLANS[plan].uploadMB),
  }
}

// Read the signed-in user's plan + today's usage (server components / routes).
export async function getPlanStatus(sb: SupabaseClient): Promise<PlanStatus | null> {
  const { data, error } = await sb.rpc('get_plan_status')
  if (error || !data || (data as RpcStatus).ok === false) return null
  return normalizeStatus(data as RpcStatus)
}

export type QuotaVerdict =
  | { ok: true; plan: Plan; callsUsed: number; callsLimit: number | null }
  | { ok: false; status: number; error: string; code: string }

// Atomic check + charge of ONE AI call. Fails CLOSED: when the check itself
// errors, no AI call goes out (same contract as the old bump_usage guard).
export async function consumeQuota(sb: SupabaseClient, feature: string, upsell: string): Promise<QuotaVerdict> {
  const { data, error } = await sb.rpc('consume_quota', { p_feature: feature })
  if (error || !data) {
    return { ok: false, status: 503, code: 'limit_check', error: 'Could not check your plan limits. Try again in a moment.' }
  }
  const j = data as { allowed?: boolean; reason?: string }
  if (j.allowed !== true) {
    if (j.reason === 'auth') return { ok: false, status: 401, code: 'auth', error: 'Please log in again.' }
    return { ok: false, status: 429, code: 'plan_limit', error: upsell }
  }
  const s = normalizeStatus(data as RpcStatus)
  return { ok: true, plan: s.plan, callsUsed: s.callsUsed, callsLimit: s.callsLimit }
}

// Badge chip colors per plan (Tailwind, dark-mode aware).
export const planChip: Record<Plan, string> = {
  free: 'bg-black/[0.06] text-current opacity-80 dark:bg-white/10',
  plus: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  pro: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  max: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
}

// 50000 -> "50K", 1000000 -> "1M", 2048 -> "2GB"
export const fmtTokens = (n: number | null) =>
  n == null ? '∞' : n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)
export const fmtMB = (mb: number) => (mb >= 1024 ? `${mb / 1024}GB` : `${mb}MB`)
