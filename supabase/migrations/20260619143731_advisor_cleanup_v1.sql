alter function public.set_updated_at()
  set search_path = '';

create policy "Owner can read owner config"
  on public.lifelog_owner_config for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.lifelog_owner_config from anon;
revoke all on table public.lifelog_owner_config from authenticated;
grant select on table public.lifelog_owner_config to authenticated;

create or replace function public.is_lifelog_owner(row_user_id uuid)
returns boolean
language sql
stable
security invoker
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
revoke all on function public.is_lifelog_owner(uuid) from anon;
grant execute on function public.is_lifelog_owner(uuid) to authenticated;

revoke all on function public.match_conversations(
  extensions.vector(1536),
  integer,
  double precision
) from anon;

revoke all on function public.save_recall_chat_turn(uuid, uuid, uuid, text, jsonb, jsonb, jsonb)
  from anon;

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;

create index if not exists lifelog_owner_config_user_id_idx
  on public.lifelog_owner_config (user_id);

create index if not exists recall_chat_messages_user_session_idx
  on public.recall_chat_messages (user_id, session_id);

create index if not exists tasks_user_conversation_idx
  on public.tasks (user_id, conversation_id);

create index if not exists transcriptions_user_conversation_idx
  on public.transcriptions (user_id, conversation_id);
