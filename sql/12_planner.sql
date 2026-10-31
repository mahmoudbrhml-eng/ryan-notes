-- 12_planner.sql — Study plan (جدول المذاكرة): spaced-repetition reviews +
-- manual tasks. Additive & idempotent (safe to re-run).
--
-- One row per task/review step. Reviews are auto-scheduled by the site when
-- the student taps "Add to study plan" on a transcribed source: today, +3
-- days, +7 days (the classic first/second/third pass). Titles are stored
-- denormalized so the plan stays intact even if the file is later deleted.
--
-- Security model (same doors pattern as 11_pdf_notes.sql):
-- - RLS: a user sees/writes ONLY their own rows.
-- - file_id / subject_id cascade on deletion; nothing is ever orphaned.

create table if not exists public.study_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  file_id    uuid references public.files(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 200),
  day        date not null,
  kind       text not null default 'review' check (kind in ('review', 'task')),
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_items_user_day_idx
  on public.study_items (user_id, day);

-- Tapping "Add to study plan" twice must never duplicate the same review day.
create unique index if not exists study_items_file_day_uniq
  on public.study_items (user_id, file_id, day)
  where file_id is not null;

alter table public.study_items enable row level security;

drop policy if exists "study_items own select" on public.study_items;
create policy "study_items own select" on public.study_items
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "study_items own insert" on public.study_items;
create policy "study_items own insert" on public.study_items
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "study_items own update" on public.study_items;
create policy "study_items own update" on public.study_items
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "study_items own delete" on public.study_items;
create policy "study_items own delete" on public.study_items
  for delete to authenticated using (auth.uid() = user_id);
