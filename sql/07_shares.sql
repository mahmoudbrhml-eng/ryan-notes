-- 07_shares.sql — public share links ("marketing before the site is even opened"):
-- a student copies a link to their summary/transcript/quiz and sends it on
-- WhatsApp/Telegram. The receiver opens /s/<token> WITHOUT an account and sees
-- a branded read-only page with a signup CTA.
--
-- Privacy model:
-- - Rows are owned by their creator (RLS: insert/select/delete owner-only).
-- - Anonymous visitors never read the table: the only public door is the
--   SECURITY DEFINER function public_share(token) which returns exactly one
--   row for an exact 24-char random token, plus share_seen(token) which bumps
--   the view counter. Nothing else is reachable by anon.

create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('summary', 'transcript', 'quiz', 'combo')),
  -- file id (summary/transcript/quiz) or merged-output id (combo), for reuse
  source_id uuid,
  title text not null default '',
  lang text,
  content text not null default '',
  questions jsonb,
  views integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists shares_user_idx on public.shares (user_id, created_at desc);
-- one link per source: sharing again returns the same URL (no link rot)
create unique index if not exists shares_source_uniq
  on public.shares (user_id, kind, source_id) where source_id is not null;

alter table public.shares enable row level security;

drop policy if exists "shares owner insert" on public.shares;
create policy "shares owner insert" on public.shares
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "shares owner read" on public.shares;
create policy "shares owner read" on public.shares
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "shares owner delete" on public.shares;
create policy "shares owner delete" on public.shares
  for delete to authenticated using (auth.uid() = user_id);

-- no anon policies on the table itself; the public doors are these two:

create or replace function public.public_share(p_token text)
returns table (
  kind text, title text, lang text, content text,
  questions jsonb, views integer, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.kind, s.title, s.lang, s.content, s.questions, s.views, s.created_at
  from public.shares s
  where s.token = left(p_token, 64)
  limit 1;
$$;

revoke all on function public.public_share(text) from public, anon;
grant execute on function public.public_share(text) to anon, authenticated;

create or replace function public.share_seen(p_token text)
returns void
language sql security definer set search_path = public as $$
  update public.shares set views = views + 1 where token = left(p_token, 64);
$$;

revoke all on function public.share_seen(text) from public, anon;
grant execute on function public.share_seen(text) to anon, authenticated;
