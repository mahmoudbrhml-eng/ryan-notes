-- 10_plans.sql — unified subscription plans shared by the Website and the
-- Telegram bot. `ai_usage` becomes ONE ROW PER USER and carries the plan plus
-- today's usage; the bot reads/writes the very same row, so both surfaces are
-- always mirrored. Limits (keep in sync with lib/plans.ts):
--   free: 5 calls/day,  1M tokens/day,    20MB upload
--   plus: 20 calls/day, 4M tokens/day,   100MB upload
--   pro:  100 calls/day, 10M tokens/day, 500MB upload
--   max:  unlimited calls/tokens,         2GB upload
--
-- Raised token budgets (free 50K→1M, plus 200K→4M, pro 1M→10M) are applied
-- to the live project by sql/10b_token_limits.sql — an idempotent patch that
-- only replaces the two functions carrying the numbers.
--
-- Contract for the Python bot (service-role key):
--   consume_quota('chat', user_id)  -> jsonb {allowed, plan, reason, ...}   (check + charge ONE call)
--   get_plan_status(user_id)        -> jsonb {plan, calls_used, limits...}  (read-only)
--   set_user_plan(user_id,'plus',30) -> activates a plan for N days          (service role only)
--   add_tokens(in, out, user_id)    -> adds real token usage after a call

-- ---------------------------------------------------------------- reshape ---
alter table public.ai_usage rename to ai_usage_old;

create table public.ai_usage (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  user_plan       text not null default 'free'
                    check (user_plan in ('free','plus','pro','max')),
  plan_expires_at timestamptz,
  tokens_used     integer not null default 0,   -- spent in the current day window
  call_count      integer not null default 0,   -- charged calls in the current day window
  day             date not null default current_date,
  updated_at      timestamptz not null default now()
);

-- carry today's counters over so nobody gets a mid-day refill
insert into public.ai_usage (user_id, call_count, day)
select user_id, coalesce(sum(calls), 0), current_date
from public.ai_usage_old
where day = current_date
group by user_id
on conflict (user_id) do update set call_count = excluded.call_count;

-- seed today's tokens from the telemetry we already recorded
update public.ai_usage u
set tokens_used = coalesce(t.n, 0)
from (
  select user_id, sum(coalesce(in_tokens, 0) + coalesce(out_tokens, 0)) as n
  from public.ai_calls
  where day = current_date and ok
  group by user_id
) t
where t.user_id = u.user_id;

drop table public.ai_usage_old;

alter table public.ai_usage enable row level security;
create policy "ai_usage_select_own" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------- helper ---
-- The owner's own web session, the service role (Telegram bot), or a direct
-- trusted connection (SQL editor / management API) may act for a user.
create or replace function public.can_act_as(p_user uuid)
returns boolean language plpgsql stable as $$
begin
  if p_user is null then return false; end if;
  return auth.uid() = p_user
      or coalesce(auth.role(), '') in ('service_role', '');
end $$;
revoke all on function public.can_act_as(uuid) from public, anon;

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
grant execute on function public.consume_quota(text, uuid) to authenticated, service_role;

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
grant execute on function public.get_plan_status(uuid) to authenticated, service_role;

-- -------------------------------------------------------------- add_tokens ---
-- Real token usage after a successful AI response (website tracker + bot).
create or replace function public.add_tokens(p_in_tokens int default 0, p_out_tokens int default 0, p_user uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := coalesce(p_user, auth.uid());
begin
  if not public.can_act_as(uid) then return; end if;
  insert into public.ai_usage (user_id) values (uid) on conflict (user_id) do nothing;
  update public.ai_usage set
    tokens_used = greatest(
      case when day = current_date then tokens_used else 0 end
        + greatest(coalesce(p_in_tokens, 0), 0) + greatest(coalesce(p_out_tokens, 0), 0),
      0),
    call_count = case when day = current_date then call_count else 0 end,
    day = current_date,
    updated_at = now()
  where user_id = uid;
end $$;
revoke all on function public.add_tokens(int, int, uuid) from public, anon;
grant execute on function public.add_tokens(int, int, uuid) to authenticated, service_role;

-- ------------------------------------------------------------ set_user_plan ---
-- Activate / change a plan. p_days = validity in days (null or <=0 = no expiry).
-- Bot (service role) calls this after a successful payment; site never does.
create or replace function public.set_user_plan(p_user uuid, p_plan text, p_days int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('service_role', '') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_user is null or p_plan not in ('free','plus','pro','max') then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  insert into public.ai_usage (user_id) values (p_user) on conflict (user_id) do nothing;
  update public.ai_usage set
    user_plan = p_plan,
    plan_expires_at = case when p_plan = 'free' or p_days is null or p_days <= 0
                           then null else now() + make_interval(days => p_days) end,
    updated_at = now()
  where user_id = p_user;
  return public.get_plan_status(p_user);
end $$;
revoke all on function public.set_user_plan(uuid, text, int) from public, anon, authenticated;
grant execute on function public.set_user_plan(uuid, text, int) to service_role;

-- ------------------------------------------------------------ refund_usage ---
create or replace function public.refund_usage(p_feature text default 'other')
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_usage
    set call_count = case when day = current_date then greatest(call_count - 1, 0) else 0 end,
        tokens_used = case when day = current_date then tokens_used else 0 end,
        day = current_date
    where user_id = auth.uid();
  update public.ai_usage_daily
    set calls = greatest(calls - 1, 0)
    where user_id = auth.uid() and day = current_date and feature = lower(p_feature);
end $$;
revoke all on function public.refund_usage(text) from public, anon;
grant execute on function public.refund_usage(text) to authenticated;

-- ------------------------------------------------- bump_usage (legacy shim) ---
-- Old routes still calling bump_usage(p_feature) get the plan-aware consume
-- under the hood; a blocked call reports an impossible count so any legacy
-- "used > LIMIT" comparison fails closed.
create or replace function public.bump_usage(p_feature text default 'other')
returns int language plpgsql security definer set search_path = public as $$
declare j jsonb;
begin
  j := public.consume_quota(p_feature);
  if coalesce(j->>'allowed', 'false') <> 'true' then
    return 2147483646;
  end if;
  return coalesce((j->>'calls_used')::int, 0);
end $$;
revoke all on function public.bump_usage(text) from public, anon;
grant execute on function public.bump_usage(text) to authenticated;

-- the zero-arg legacy variant references the old table shape — gone for good
drop function if exists public.bump_usage();
