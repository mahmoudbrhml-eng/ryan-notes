-- 13_mindmap_kind.sql — allow kind='mindmap' in outputs (additive, idempotent).
-- The original CHECK in 03_step9.sql whitelisted transcript/summary/quiz/merged;
-- the mind map stores its tree in `data` jsonb exactly like quiz does, so the
-- only change needed is widening the whitelist. Existing rows all stay valid.

alter table public.outputs drop constraint if exists outputs_kind_check;
alter table public.outputs add constraint outputs_kind_check
  check (kind = any (array['transcript'::text, 'summary'::text, 'quiz'::text, 'merged'::text, 'mindmap'::text]));
