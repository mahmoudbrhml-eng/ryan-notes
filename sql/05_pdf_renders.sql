-- PDF render telemetry: one row per download attempt (engine, pages, completeness, device).
-- Run once in Supabase SQL Editor. Users may only INSERT their own rows; nobody can SELECT via the API.
create table if not exists public.pdf_renders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  doc text not null default 'unknown',
  mode text not null default 'paged',
  pages integer,
  src_len integer,
  out_len integer,
  ms integer,
  ok boolean not null default true,
  err text,
  ua text
);
alter table public.pdf_renders enable row level security;
drop policy if exists pdf_renders_own_insert on public.pdf_renders;
create policy pdf_renders_own_insert on public.pdf_renders for insert to authenticated with check (auth.uid() = user_id);
