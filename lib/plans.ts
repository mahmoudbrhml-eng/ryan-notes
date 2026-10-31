// Plan limits — the single source of truth is sql/10_plans.sql + the additive
// patch sql/10c_audio_hours.sql (consume_quota / consume_transcribe_quota /
// get_plan_status). Keep these numbers in sync with them. Pure data + types
// only: this file must stay importable from both server and client code.
//
// Transcribing AUDIO/VIDEO is metered in MONTHLY HOURS (hoursPerMonth — the
// recording's real duration; see consume_transcribe_quota). Calls/tokens stay
// for the other AI features (summary, quiz, chat, merge) and for text
// conversions; uploadMB caps a single upload.
import type { SupabaseClient } from '@supabase/supabase-js'

export type Plan = 'free' | 'plus' | 'pro' | 'max'
export const PLAN_ORDER: Plan[] = ['free', 'plus', 'pro', 'max']

export const PLANS: Record<Plan, {
  callsPerDay: number; tokensPerDay: number; uploadMB: number; hoursPerMonth: number
}> = {
  free: { callsPerDay: 5, tokensPerDay: 1_000_000, uploadMB: 20, hoursPerMonth: 10 },
  plus: { callsPerDay: 20, tokensPerDay: 4_000_000, uploadMB: 100, hoursPerMonth: 30 },
  pro: { callsPerDay: 100, tokensPerDay: 10_000_000, uploadMB: 500, hoursPerMonth: 60 },
  max: { callsPerDay: Infinity, tokensPerDay: Infinity, uploadMB: 2048, hoursPerMonth: Infinity },
}

export type PlanStatus = {
  plan: Plan
  planExpiresAt: string | null
  callsUsed: number
  callsLimit: number | null // null = unlimited
  tokensUsed: number
  tokensLimit: number | null
  uploadMB: number
  audioSecondsUsed: number
  audioSecondsLimit: number | null // null = unlimited
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
  audio_seconds_used?: number
  audio_seconds_limit?: number | null
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
    audioSecondsUsed: Number(j.audio_seconds_used ?? 0),
    audioSecondsLimit: j.audio_seconds_limit == null ? null : Number(j.audio_seconds_limit),
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

// Atomic check + charge of ONE transcription against the monthly-hours quota
// (media = charged by real duration; doc/text = daily token check only, no
// call charge). Same fail-closed contract as consumeQuota. `upsellHours` /
// `upsellTokens` are the localized messages shown on 429.
export async function consumeTranscribeQuota(
  sb: SupabaseClient,
  media: boolean,
  seconds: number,
  upsellHours: string,
  upsellTokens: string,
): Promise<QuotaVerdict> {
  const { data, error } = await sb.rpc('consume_transcribe_quota', {
    p_media: media,
    p_seconds: Math.max(0, Math.round(seconds || 0)),
  })
  if (error || !data) {
    return { ok: false, status: 503, code: 'limit_check', error: 'Could not check your plan limits. Try again in a moment.' }
  }
  const j = data as { allowed?: boolean; reason?: string }
  if (j.allowed !== true) {
    if (j.reason === 'auth') return { ok: false, status: 401, code: 'auth', error: 'Please log in again.' }
    return { ok: false, status: 429, code: 'plan_limit', error: j.reason === 'hours' ? upsellHours : upsellTokens }
  }
  const s = normalizeStatus(data as RpcStatus)
  return { ok: true, plan: s.plan, callsUsed: s.callsUsed, callsLimit: s.callsLimit }
}

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
// 36000 seconds -> "10h"; null (max plan) -> "∞"
export const fmtHours = (seconds: number | null) =>
  seconds == null
    ? '∞'
    : `${Math.round(seconds / 360) / 10}h` // one decimal, trims trailing .0
