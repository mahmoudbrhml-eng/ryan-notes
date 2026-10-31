-- 09_radar.sql — Weakness Radar ("the site knows exactly where you slip").
-- Run once in Supabase -> SQL Editor.
--
-- Every finished quiz (per-file or radar practice) stores one row per answered
-- question. The radar aggregates these rows into: overall accuracy, accuracy
-- per source, and the questions that keep tripping the student — which the
-- practice generator then targets.
--
-- Security model (same doors pattern as 08_telegram.sql):
-- - RLS: a user sees/writes ONLY their own rows (select/insert/delete).
-- - Rows are immutable (no update policy on purpose — history stays honest).
-- - q_text stores the question text itself, not an index, because regenerating
--   a quiz overwrites the stored questions — text survives regeneration.

create table if not exists public.quiz_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  q_text text not null,
  correct boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists quiz_attempts_user_subject_idx
  on public.quiz_attempts (user_id, subject_id, created_at desc);

alter table public.quiz_attempts enable row level security;

drop policy if exists "radar own select" on public.quiz_attempts;
create policy "radar own select" on public.quiz_attempts
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "radar own insert" on public.quiz_attempts;
create policy "radar own insert" on public.quiz_attempts
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "radar own delete" on public.quiz_attempts;
create policy "radar own delete" on public.quiz_attempts
  for delete to authenticated using (auth.uid() = user_id);
