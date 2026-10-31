-- 10c_audio_hours.sql — transcription moves to MONTHLY HOURS (additive,
-- idempotent, safe to run any number of times on the live project).
--
--   free: 10 h / month    plus: 30 h / month    pro: 60 h / month    max: unlimited
--
-- Model (user request, 2026-11): transcribing AUDIO/VIDEO is metered by the
-- recording's REAL duration against a monthly budget — no per-call charge, no
-- token charge (audio tokens are huge and meaningless to students). Documents
-- / text conversions keep the daily token budget (no call charge either, so a
-- big PDF no longer burns through 5 daily calls). Every other AI feature
-- (summary, quiz, chat, merge, practice) keeps the existing daily calls +
-- tokens contract — consume_quota is NOT touched, so the Python bot keeps
-- working unchanged.
--
-- Adds two nullable-safe columns to ai_usage (no reshape, no drops):
--   audio_seconds — charged seconds in the current month window
--   month         — first day of the current monthly window
-- and three functions:
--   consume_transcribe_quota(media, seconds, user)  -> check + charge (bot can call it too)
--   refund_transcribe_quota(media, seconds, user)   -> give the hours back on failure
--   get_plan_status(user)                           -> same keys as before PLUS audio_seconds_*
--                                                      (added keys only = backward compatible)

-- ------------------------------------------------------------------ columns ---
alter table public.ai_usage add column if not exists audio_seconds integer not null default 0;
alter table public.ai_usage add column if not exists month date not null default date_trunc('month', current_date)::date;

-- ------------------------------------------------- consume_transcribe_quota ---
create or replace function public.consume_transcribe_quota(
  p_media boolean default false,
  p_seconds int default 0,
  p_user uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := coalesce(p_user, auth.uid());
  rec public.ai_usage%rowtype;
  v_plan text;
  v_hours_limit bigint;
  v_tokens_limit bigint;
  v_seconds int := greatest(coalesce(p_seconds, 0), 0);
begin
  if not public.can_act_as(uid) then
    return jsonb_build_object('allowed', false, 'reason',
      case when uid is null then 'auth' else 'forbidden' end);
  end if;

  insert into public.ai_usage (user_id) values (uid) on conflict (user_id) do nothing;
  select * into rec from public.ai_usage where user_id = uid for update;

  -- expired paid plans silently fall back to free (same self-healing as consume_quota)
  v_plan := case when rec.plan_expires_at is not null and rec.plan_expires_at < now()
                 then 'free' else rec.user_plan end;
  if v_plan <> rec.user_plan then
    update public.ai_usage set user_plan = 'free', plan_expires_at = null
      where user_id = uid;
  end if;

  -- roll the MONTHLY hours window (resets on the 1st, UTC)
  if rec.month is null or rec.month <> date_trunc('month', current_date)::date then
    update public.ai_usage set month = date_trunc('month', current_date)::date, audio_seconds = 0
      where user_id = uid;
    rec.audio_seconds := 0;
    rec.month := date_trunc('month', current_date)::date;
  end if;

  -- roll the daily token window (text conversions still live on tokens)
  if rec.day <> current_date then
    update public.ai_usage set day = current_date, call_count = 0, tokens_used = 0
      where user_id = uid;
    rec.tokens_used := 0;
  end if;

  -- seconds per month: 10h=36000, 30h=108000, 60h=216000, max=unlimited
  v_hours_limit := case v_plan
    when 'plus' then 108000 when 'pro' then 216000 when 'max' then 2147483647 else 36000 end;
  v_tokens_limit := case v_plan
    when 'plus' then 4000000 when 'pro' then 10000000 when 'max' then 2147483647 else 1000000 end;

  if p_media then
    -- audio / video / YouTube: charged by REAL duration against monthly hours
    if v_plan <> 'max' and rec.audio_seconds + v_seconds > v_hours_limit then
      return jsonb_build_object(
        'allowed', false, 'plan', v_plan, 'reason', 'hours',
        'audio_seconds_used', rec.audio_seconds,
        'audio_seconds_limit', nullif(v_hours_limit, 2147483647));
    end if;
    update public.ai_usage
      set audio_seconds = audio_seconds + v_seconds, updated_at = now()
      where user_id = uid
      returning audio_seconds into rec.audio_seconds;
  else
    -- documents / text: daily token budget only (no call charge, no hours)
    if v_plan <> 'max' and rec.tokens_used >= v_tokens_limit then
      return jsonb_build_object(
        'allowed', false, 'plan', v_plan, 'reason', 'tokens',
        'tokens_used', rec.tokens_used,
        'tokens_limit', nullif(v_tokens_limit, 2147483647));
    end if;
  end if;

  -- keep the per-feature daily counter (the usage page) in sync
  insert into public.ai_usage_daily (user_id, day, feature, calls)
    values (uid, current_date, 'transcribe', 1)
    on conflict (user_id, day, feature) do update set calls = public.ai_usage_daily.calls + 1;

  return jsonb_build_object('allowed', true, 'plan', v_plan,
    'audio_seconds_used', rec.audio_seconds,
    'audio_seconds_limit', nullif(v_hours_limit, 2147483647),
    'tokens_used', rec.tokens_used,
    'tokens_limit', nullif(v_tokens_limit, 2147483647));
end $$;
revoke all on function public.consume_transcribe_quota(boolean, int, uuid) from public, anon;
grant execute on function public.consume_transcribe_quota(boolean, int, uuid) to authenticated, service_role;

-- ------------------------------------------------- refund_transcribe_quota ---
create or replace function public.refund_transcribe_quota(
  p_media boolean default false,
  p_seconds int default 0,
  p_user uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := coalesce(p_user, auth.uid());
begin
  if not public.can_act_as(uid) then return; end if;
  if p_media then
    update public.ai_usage
      set audio_seconds = greatest(audio_seconds - greatest(coalesce(p_seconds, 0), 0), 0),
          updated_at = now()
      where user_id = uid
        and month = date_trunc('month', current_date)::date;
  end if;
  update public.ai_usage_daily
    set calls = greatest(calls - 1, 0)
    where user_id = uid and day = current_date and feature = 'transcribe';
end $$;
revoke all on function public.refund_transcribe_quota(boolean, int, uuid) from public, anon;
grant execute on function public.refund_transcribe_quota(boolean, int, uuid) to authenticated, service_role;

-- --------------------------------------------------------- get_plan_status ---
-- Same keys the bot already reads, PLUS audio_seconds_used / audio_seconds_limit.
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
      'calls_used', 0, 'tokens_used', 0, 'audio_seconds_used', 0,
      'calls_limit', 5, 'tokens_limit', 1000000, 'audio_seconds_limit', 36000,
      'upload_mb', 20, 'day', current_date);
  end if;
  select * into rec from public.ai_usage where user_id = uid;
  v_plan := case when rec.plan_expires_at is not null and rec.plan_expires_at < now()
                 then 'free' else rec.user_plan end;
  return jsonb_build_object(
    'ok', true, 'plan', v_plan, 'plan_expires_at', rec.plan_expires_at,
    'calls_used', case when rec.day = current_date then rec.call_count else 0 end,
    'tokens_used', case when rec.day = current_date then rec.tokens_used else 0 end,
    'audio_seconds_used', case when rec.month = date_trunc('month', current_date)::date
                               then rec.audio_seconds else 0 end,
    'calls_limit', case v_plan when 'plus' then 20 when 'pro' then 100 when 'max' then null else 5 end,
    'tokens_limit', case v_plan when 'plus' then 4000000 when 'pro' then 10000000 when 'max' then null else 1000000 end,
    'audio_seconds_limit', case v_plan when 'plus' then 108000 when 'pro' then 216000 when 'max' then null else 36000 end,
    'upload_mb', case v_plan when 'plus' then 100 when 'pro' then 500 when 'max' then 2048 else 20 end,
    'day', current_date);
end $$;

revoke all on function public.get_plan_status(uuid) from public, anon;
