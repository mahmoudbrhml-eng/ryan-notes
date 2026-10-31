-- 11_pdf_notes.sql — PDF reader annotations ("ضيف بس إنك تقدر تعدّل عليه").
-- Run once in Supabase -> SQL Editor (idempotent: safe to re-run).
--
-- One row per (user, file, page): `items` holds that page's annotations as a
-- JSONB array — pen strokes, highlight rectangles and sticky notes, all in
-- coordinates normalized 0..1 to the page box, so they survive zoom / device
-- changes. The reader replaces the whole page row on every save (debounced),
-- which keeps undo/redo and offline edits trivially correct.
--
-- Security model (same doors pattern as 09_radar.sql):
-- - RLS: a user sees/writes ONLY their own rows (select/insert/update/delete).
-- - file_id cascades on file deletion; nothing is ever orphaned.

create table if not exists public.pdf_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  file_id    uuid not null references public.files(id) on delete cascade,
  page       integer not null check (page >= 1),
  items      jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, file_id, page)
);

create index if not exists pdf_notes_file_idx
  on public.pdf_notes (file_id, user_id);

alter table public.pdf_notes enable row level security;

drop policy if exists "pdf_notes own select" on public.pdf_notes;
create policy "pdf_notes own select" on public.pdf_notes
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "pdf_notes own insert" on public.pdf_notes;
create policy "pdf_notes own insert" on public.pdf_notes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "pdf_notes own update" on public.pdf_notes;
create policy "pdf_notes own update" on public.pdf_notes
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "pdf_notes own delete" on public.pdf_notes;
create policy "pdf_notes own delete" on public.pdf_notes
  for delete to authenticated using (auth.uid() = user_id);
