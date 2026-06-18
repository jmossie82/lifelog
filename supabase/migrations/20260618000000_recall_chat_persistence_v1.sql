create table public.recall_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  latest_user_text text,
  source_count integer not null default 0 check (source_count >= 0),
  message_count integer not null default 0 check (message_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.recall_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  parts jsonb not null,
  source_citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (user_id, session_id)
    references public.recall_chat_sessions(user_id, id)
    on delete cascade
);

create index recall_chat_sessions_user_updated_at_idx
  on public.recall_chat_sessions (user_id, updated_at desc);

create index recall_chat_messages_session_created_at_idx
  on public.recall_chat_messages (session_id, created_at asc);

create trigger recall_chat_sessions_set_updated_at
  before update on public.recall_chat_sessions
  for each row execute function public.set_updated_at();

alter table public.recall_chat_sessions enable row level security;
alter table public.recall_chat_messages enable row level security;

create policy "Owner can read recall chat sessions"
  on public.recall_chat_sessions for select
  to authenticated
  using (public.is_lifelog_owner(user_id));

create policy "Owner can insert recall chat sessions"
  on public.recall_chat_sessions for insert
  to authenticated
  with check (public.is_lifelog_owner(user_id));

create policy "Owner can update recall chat sessions"
  on public.recall_chat_sessions for update
  to authenticated
  using (public.is_lifelog_owner(user_id))
  with check (public.is_lifelog_owner(user_id));

create policy "Owner can read recall chat messages"
  on public.recall_chat_messages for select
  to authenticated
  using (public.is_lifelog_owner(user_id));

create policy "Owner can insert recall chat messages"
  on public.recall_chat_messages for insert
  to authenticated
  with check (public.is_lifelog_owner(user_id));

create policy "Owner can update recall chat messages"
  on public.recall_chat_messages for update
  to authenticated
  using (public.is_lifelog_owner(user_id))
  with check (public.is_lifelog_owner(user_id));
