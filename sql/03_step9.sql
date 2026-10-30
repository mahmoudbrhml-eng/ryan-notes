-- Ryan Notes step 9: link sources (YouTube / websites). Run once in Supabase -> SQL Editor.
alter table public.files add column if not exists source_url text;
