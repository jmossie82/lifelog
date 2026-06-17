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
  unique (user_id, fieldy_id),
  unique (user_id, id)
);

create table public.transcriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  fieldy_segment_id text not null,
  speaker_label text,
  text text not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fieldy_segment_id),
  foreign key (user_id, conversation_id)
    references public.conversations(user_id, id)
    on delete cascade
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid,
  fieldy_task_id text not null,
  title text not null,
  status text not null,
  due_at timestamptz,
  fieldy_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fieldy_task_id),
  foreign key (user_id, conversation_id)
    references public.conversations(user_id, id)
    on delete set null (conversation_id)
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

create table public.lifelog_owner_config (
  id smallint primary key default 1,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lifelog_owner_config_single_row check (id = 1)
);

create or replace function public.is_lifelog_owner(row_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) = row_user_id
    and exists (
      select 1
      from public.lifelog_owner_config
      where user_id = row_user_id
    );
$$;

revoke all on function public.is_lifelog_owner(uuid) from public;
grant execute on function public.is_lifelog_owner(uuid) to authenticated;

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

create trigger lifelog_owner_config_set_updated_at
  before update on public.lifelog_owner_config
  for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;
alter table public.transcriptions enable row level security;
alter table public.tasks enable row level security;
alter table public.sync_runs enable row level security;
alter table public.lifelog_owner_config enable row level security;

create policy "Owner can read conversations"
  on public.conversations for select
  to authenticated
  using (public.is_lifelog_owner(user_id));

create policy "Owner can read transcriptions"
  on public.transcriptions for select
  to authenticated
  using (public.is_lifelog_owner(user_id));

create policy "Owner can read tasks"
  on public.tasks for select
  to authenticated
  using (public.is_lifelog_owner(user_id));

create policy "Owner can read sync runs"
  on public.sync_runs for select
  to authenticated
  using (public.is_lifelog_owner(user_id));
