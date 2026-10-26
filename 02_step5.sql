-- Ryan Notes step 5: AI transcription support. Run once in Supabase -> SQL Editor.

alter table public.files
  add column if not exists ai_status text not null default 'idle'
    check (ai_status in ('idle','processing','done','error')),
  add column if not exists ai_error text;

-- Deleting a file should delete its generated outputs too.
alter table public.outputs drop constraint if exists outputs_file_id_fkey;
alter table public.outputs
  add constraint outputs_file_id_fkey foreign key (file_id) references public.files(id) on delete cascade;

create unique index if not exists outputs_file_kind_uidx
  on public.outputs (file_id, kind) where file_id is not null;

-- Per-user daily AI usage counter
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default current_date,
  calls   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy "ai_usage_select_own" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.bump_usage() returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into public.ai_usage (user_id, day, calls) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set calls = public.ai_usage.calls + 1
  returning calls into c;
  return c;
end $$;
revoke all on function public.bump_usage() from public;
grant execute on function public.bump_usage() to authenticated;
