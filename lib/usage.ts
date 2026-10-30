import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallInfo } from './gemini'

// Turns every Gemini attempt into a fire-and-forget `ai_calls` row so the
// platform can answer, with real numbers: which feature consumes the daily
// limit, which key is running dry, and whether more keys are ever needed.
// user_id is filled by the column default (auth.uid()); failures are swallowed
// — telemetry must never break an AI response.
export function tracker(sb: SupabaseClient, feature: string): (i: CallInfo) => void {
  return (i) => {
    void sb
      .from('ai_calls')
      .insert({
        feature,
        key_index: i.keyIndex,
        model: i.model.slice(0, 60),
        ok: i.ok,
        status: i.status,
        in_tokens: i.inTokens,
        out_tokens: i.outTokens,
        ms: Math.min(i.ms, 2_000_000_000),
      })
      .then(() => {}, () => {})
  }
}
