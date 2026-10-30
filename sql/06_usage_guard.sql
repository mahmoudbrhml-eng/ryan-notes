-- 06_usage_guard.sql — hardening for the daily AI limit:
-- 1) refund_usage(p_feature): gives one call back (transcribe/summary/quiz/
--    chat/merge) for TODAY when the generation failed, so users are never
--    charged for answers they did not get. Both the total counter (ai_usage)
--    and the per-feature counter (ai_usage_daily) are decremented, floored 0.
-- 2) bump_usage: EXECUTE pulled from anon/public. Routes always call it with
--    the signed-in user's session (authenticated), so chat/summary/quiz keep
--    working; anonymous callers can no longer touch the counter.

create or replace function public.refund_usage(p_feature text default 'other')
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_usage
    set calls = greatest(calls - 1, 0)
    where user_id = auth.uid() and day = current_date;
  update public.ai_usage_daily
    set calls = greatest(calls - 1, 0)
    where user_id = auth.uid() and day = current_date and feature = lower(p_feature);
end $$;

revoke all on function public.refund_usage(text) from public, anon;
grant execute on function public.refund_usage(text) to authenticated;

-- bump_usage may exist as bump_usage() (legacy zero-arg) and/or
-- bump_usage(p_feature): strip anon access from whichever exist.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bump_usage'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
