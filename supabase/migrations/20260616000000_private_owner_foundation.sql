create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fieldy_id text not null,
  title text,
  summary text,
  content text,
  keywords text[] not null default '{}',
  started_at timestamptz,
  ended_at timestamptz,
  fieldy_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fieldy_id)
);

create table public.transcriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  fieldy_segment_id text not null,
  speaker_label text,
  text text not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fieldy_segment_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  fieldy_task_id text not null,
  title text not null,
  status text not null,
  due_at timestamptz,
  fieldy_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fieldy_task_id)
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('webhook', 'backfill')),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  imported_count integer not null default 0,
  error_message text
);

create index conversations_user_started_at_idx
  on public.conversations (user_id, started_at desc nulls last);

create index transcriptions_conversation_id_idx
  on public.transcriptions (conversation_id);

create index tasks_user_status_idx
  on public.tasks (user_id, status);

create index sync_runs_user_started_at_idx
  on public.sync_runs (user_id, started_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create trigger transcriptions_set_updated_at
  before update on public.transcriptions
  for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;
alter table public.transcriptions enable row level security;
alter table public.tasks enable row level security;
alter table public.sync_runs enable row level security;

create policy "Owner can read conversations"
  on public.conversations for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owner can insert conversations"
  on public.conversations for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Owner can update conversations"
  on public.conversations for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owner can read transcriptions"
  on public.transcriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owner can insert transcriptions"
  on public.transcriptions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Owner can update transcriptions"
  on public.transcriptions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owner can read tasks"
  on public.tasks for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owner can insert tasks"
  on public.tasks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Owner can update tasks"
  on public.tasks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owner can read sync runs"
  on public.sync_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owner can insert sync runs"
  on public.sync_runs for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Owner can update sync runs"
  on public.sync_runs for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
