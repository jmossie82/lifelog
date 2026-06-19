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
  turn_id uuid not null,
  message_order integer not null check (message_order > 0),
  role text not null check (role in ('user', 'assistant')),
  parts jsonb not null,
  source_citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (user_id, session_id)
    references public.recall_chat_sessions(user_id, id)
    on delete cascade,
  unique (session_id, turn_id, role),
  unique (session_id, message_order)
);

create index recall_chat_sessions_user_updated_at_idx
  on public.recall_chat_sessions (user_id, updated_at desc);

create index recall_chat_messages_session_order_idx
  on public.recall_chat_messages (session_id, message_order desc);

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

create or replace function public.save_recall_chat_turn(
  session_user_id uuid,
  chat_session_id uuid,
  turn_id_value uuid,
  latest_user_text_value text,
  source_count_value integer,
  user_parts_value jsonb,
  assistant_parts_value jsonb,
  source_citations_value jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_message_order integer;
  inserted_message_count integer;
begin
  perform 1
  from public.recall_chat_sessions
  where id = chat_session_id
    and user_id = session_user_id
    and public.is_lifelog_owner(session_user_id)
  for update;

  if not found then
    raise exception 'Recall chat session not found';
  end if;

  select coalesce(max(message_order), 0) + 1
    into next_message_order
  from public.recall_chat_messages
  where user_id = session_user_id
    and session_id = chat_session_id;

  insert into public.recall_chat_messages (
    user_id,
    session_id,
    turn_id,
    message_order,
    role,
    parts,
    source_citations
  )
  values
    (
      session_user_id,
      chat_session_id,
      turn_id_value,
      next_message_order,
      'user',
      user_parts_value,
      '[]'::jsonb
    ),
    (
      session_user_id,
      chat_session_id,
      turn_id_value,
      next_message_order + 1,
      'assistant',
      assistant_parts_value,
      source_citations_value
    )
  on conflict (session_id, turn_id, role) do nothing;

  get diagnostics inserted_message_count = row_count;

  if inserted_message_count > 0 then
    update public.recall_chat_sessions
    set
      latest_user_text = latest_user_text_value,
      source_count = source_count_value,
      message_count = public.recall_chat_sessions.message_count + inserted_message_count
    where id = chat_session_id
      and user_id = session_user_id
      and public.is_lifelog_owner(session_user_id);
  end if;
end;
$$;

revoke all on function public.save_recall_chat_turn(uuid, uuid, uuid, text, integer, jsonb, jsonb, jsonb) from public;
grant execute on function public.save_recall_chat_turn(uuid, uuid, uuid, text, integer, jsonb, jsonb, jsonb) to authenticated;
