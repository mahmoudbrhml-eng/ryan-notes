-- Ryan Notes step 10: allow combined notes. Run once in Supabase -> SQL Editor.
alter table public.outputs drop constraint if exists outputs_kind_check;
alter table public.outputs
  add constraint outputs_kind_check check (kind in ('transcript','summary','quiz','merged'));
