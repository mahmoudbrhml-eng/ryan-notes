-- 08_telegram.sql — Telegram notifications ("your material is ready, without
-- waiting in the tab"). Run once in Supabase -> SQL Editor.
--
-- Flow: the site issues a one-time link token, the user opens
-- t.me/<bot>?start=<token> and presses START, Telegram posts the update to
-- /api/telegram/webhook, and the webhook binds chat_id -> user through the
-- SECURITY DEFINER function below. After that, finished AI work
-- (transcript / summary / quiz) sends a message to that chat.
--
-- Security model (same doors pattern as 07_shares.sql):
-- - Rows are owner-only via RLS (read/insert/update/delete = own row).
--   The owner can write their own row ONLY with a token they generated
--   in-app; the actual chat_id write happens through telegram_bind(), which
--   accepts a valid unexpired one-time token, never raw client input.
-- - No anon policies on the table. The single public door is
--   telegram_bind(token, chat_id, title): without a valid token it can
--   only answer "already bound" for an exact chat_id match. Tokens are
--   24 random bytes, single-use, and expire in 30 minutes.

create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id text,
  chat_title text,
  linked_at timestamptz,
  link_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Fast lookup for the webhook's "already bound" answer and future lookups.
create index if not exists telegram_links_chat_idx on public.telegram_links (chat_id)
  where chat_id is not null;

alter table public.telegram_links enable row level security;

drop policy if exists "telegram own select" on public.telegram_links;
create policy "telegram own select" on public.telegram_links
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "telegram own insert" on public.telegram_links;
create policy "telegram own insert" on public.telegram_links
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "telegram own update" on public.telegram_links;
create policy "telegram own update" on public.telegram_links
  for update to authenticated using (auth.uid() = user_id);

drop policy if exists "telegram own delete" on public.telegram_links;
create policy "telegram own delete" on public.telegram_links
  for delete to authenticated using (auth.uid() = user_id);

-- The one public door: bind a Telegram chat to the user who owns this
-- one-time token. Returns 'ok' | 'already' | 'bad'.
create or replace function public.telegram_bind(p_token text, p_chat_id text, p_title text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if p_token is null or p_chat_id is null then
    return 'bad';
  end if;

  select user_id into uid
  from public.telegram_links
  where link_token = left(p_token, 100)
    and token_expires_at is not null
    and token_expires_at > now()
  limit 1;

  if uid is not null then
    update public.telegram_links
    set chat_id = left(p_chat_id, 64),
        chat_title = left(coalesce(nullif(p_title, ''), 'Telegram'), 120),
        linked_at = now(),
        link_token = null,
        token_expires_at = null
    where user_id = uid;
    return 'ok';
  end if;

  -- No valid token. If this exact chat is already bound, say so instead of
  -- scolding the user for pressing START twice.
  if exists (select 1 from public.telegram_links where chat_id = left(p_chat_id, 64) limit 1) then
    return 'already';
  end if;

  return 'bad';
end $$;

revoke all on function public.telegram_bind(text, text, text) from public, anon, authenticated;
grant execute on function public.telegram_bind(text, text, text) to anon, authenticated;
