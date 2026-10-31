import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallInfo } from './gemini'

// Turns every Gemini attempt into a fire-and-forget `ai_calls` row so the
// platform can answer, with real numbers: which feature consumes the daily
// limit, which key is running dry, and whether more keys are ever needed.
// user_id is filled by the column default (auth.uid()); failures are swallowed
// — telemetry must never break an AI response. `after()` keeps the insert
// running after the response is already on the wire (Vercel would otherwise
// freeze the function and lose the row). Successful calls also add their real
// token counts to the user's plan usage (ai_usage.tokens_used) unless
// opts.noTokens — transcription of audio/video is metered in MONTHLY HOURS
// instead (sql/10c_audio_hours.sql), so its huge audio tokens must not eat the
// daily text-token budget. Rows are still recorded for telemetry.
export function tracker(
  sb: SupabaseClient,
  feature: string,
  opts?: { noTokens?: boolean },
): (i: CallInfo) => void {
  return (i) => {
    after(async () => {
      try {
        await sb.from('ai_calls').insert({
          feature,
          key_index: i.keyIndex,
          model: i.model.slice(0, 60),
          ok: i.ok,
          status: i.status,
          in_tokens: i.inTokens,
          out_tokens: i.outTokens,
          ms: Math.min(i.ms, 2_000_000_000),
        })
        if (!opts?.noTokens && i.ok && (i.inTokens || i.outTokens)) {
          await sb.rpc('add_tokens', {
            p_in_tokens: Math.max(0, i.inTokens ?? 0),
            p_out_tokens: Math.max(0, i.outTokens ?? 0),
          })
        }
      } catch {}
    })
  }
}
