import type { SupabaseClient } from '@supabase/supabase-js'
import { getI18n } from './i18n'
import { consumeQuota, type QuotaVerdict } from './plans'

// Server-side guard used by every AI route: charges one call against the
// user's plan and returns a LOCALIZED upsell message on 429, so every surface
// (jobs panel, chat, quiz, summary) shows the right language automatically.
export async function guardQuota(sb: SupabaseClient, feature: string): Promise<QuotaVerdict> {
  const { t } = await getI18n()
  return consumeQuota(sb, feature, t.errors.plan_limit)
}
