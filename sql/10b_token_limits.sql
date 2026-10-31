-- 10b_token_limits.sql — raised daily token budgets, applied to the LIVE
-- project (10_plans.sql already ran once and must NOT be re-run: it reshapes
-- ai_usage). Idempotent: only replaces the two functions that carry numbers.
--   free: 1M tokens/day   plus: 4M   pro: 10M   max: unlimited
-- Calls/day and upload caps are unchanged. Keep in sync with lib/plans.ts.
-- Safe for the Python bot: same function signatures, same jsonb contract —
-- it just starts seeing the new limits from its next consume_quota call.

-- ---------------------------------------------------------- consume_quota ---
-- Atomic check + charge of ONE AI call against the user's plan. Blocked calls
-- are NOT charged. Fails closed (routes show a soft error when this errors).
create or replace function public.consume_quota(p_feature text default 'other', p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := coalesce(p_user, auth.uid());
  rec public.ai_usage%rowtype;
  v_plan text;
  v_calls_limit int;
  v_tokens_limit bigint;
begin
  if not public.can_act_as(uid) then
    return jsonb_build_object('allowed', false, 'reason',
      case when uid is null then 'auth' else 'forbidden' end);
  end if;

  insert into public.ai_usage (user_id) values (uid) on conflict (user_id) do nothing;
  select * into rec from public.ai_usage where user_id = uid for update;

  -- expired paid plans silently fall back to free (self-healing)
  v_plan := case when rec.plan_expires_at is not null and rec.plan_expires_at < now()
                 then 'free' else rec.user_plan end;
  if v_plan <> rec.user_plan then
    update public.ai_usage set user_plan = 'free', plan_expires_at = null
      where user_id = uid;
  end if;

  -- roll the daily window (counters reset at midnight UTC)
  if rec.day <> current_date then
    rec.call_count := 0;
    rec.tokens_used := 0;
    update public.ai_usage set day = current_date, call_count = 0, tokens_used = 0
      where user_id = uid;
  end if;

  v_calls_limit := case v_plan
    when 'plus' then 20 when 'pro' then 100 when 'max' then 2147483647 else 5 end;
  v_tokens_limit := case v_plan
    when 'plus' then 4000000 when 'pro' then 10000000 when 'max' then 2147483647 else 1000000 end;

  if v_plan <> 'max' and (rec.call_count + 1 > v_calls_limit or rec.tokens_used >= v_tokens_limit) then
    return jsonb_build_object(
      'allowed', false, 'plan', v_plan,
      'reason', case when rec.call_count + 1 > v_calls_limit then 'calls' else 'tokens' end,
      'calls_used', rec.call_count,
      'calls_limit', nullif(v_calls_limit, 2147483647),
      'tokens_used', rec.tokens_used,
      'tokens_limit', nullif(v_tokens_limit, 2147483647));
  end if;

  update public.ai_usage
    set call_count = call_count + 1, updated_at = now()
    where user_id = uid
    returning call_count into rec.call_count;

  -- keep the per-feature daily counter (the usage page) in sync
  insert into public.ai_usage_daily (user_id, day, feature, calls)
    values (uid, current_date, lower(coalesce(p_feature, 'other')), 1)
    on conflict (user_id, day, feature) do update set calls = public.ai_usage_daily.calls + 1;

  return jsonb_build_object('allowed', true, 'plan', v_plan,
    'calls_used', rec.call_count,
    'calls_limit', nullif(v_calls_limit, 2147483647),
    'tokens_used', rec.tokens_used,
    'tokens_limit', nullif(v_tokens_limit, 2147483647));
end $$;
revoke all on function public.consume_quota(text, uuid) from public, anon;

-- --------------------------------------------------------- get_plan_status ---
create or replace function public.get_plan_status(p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := coalesce(p_user, auth.uid());
  rec public.ai_usage%rowtype;
  v_plan text;
begin
  if not public.can_act_as(uid) then
    return jsonb_build_object('ok', false, 'reason',
      case when uid is null then 'auth' else 'forbidden' end);
  end if;
  if not exists (select 1 from public.ai_usage where user_id = uid) then
    return jsonb_build_object(
      'ok', true, 'plan', 'free', 'plan_expires_at', null,
      'calls_used', 0, 'tokens_used', 0,
      'calls_limit', 5, 'tokens_limit', 1000000, 'upload_mb', 20, 'day', current_date);
  end if;
  select * into rec from public.ai_usage where user_id = uid;
  v_plan := case when rec.plan_expires_at is not null and rec.plan_expires_at < now()
                 then 'free' else rec.user_plan end;
  return jsonb_build_object(
    'ok', true, 'plan', v_plan, 'plan_expires_at', rec.plan_expires_at,
    'calls_used', case when rec.day = current_date then rec.call_count else 0 end,
    'tokens_used', case when rec.day = current_date then rec.tokens_used else 0 end,
    'calls_limit', case v_plan when 'plus' then 20 when 'pro' then 100 when 'max' then null else 5 end,
    'tokens_limit', case v_plan when 'plus' then 4000000 when 'pro' then 10000000 when 'max' then null else 1000000 end,
    'upload_mb', case v_plan when 'plus' then 100 when 'pro' then 500 when 'max' then 2048 else 20 end,
    'day', current_date);
end $$;

revoke all on function public.get_plan_status(uuid) from public, anon;
