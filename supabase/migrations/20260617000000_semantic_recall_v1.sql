create extension if not exists vector with schema extensions;

alter table public.conversations
  add column embedding extensions.vector(1536),
  add column embedding_model text,
  add column embedding_input_hash text,
  add column embedded_at timestamptz,
  add column embedding_error text;

create index conversations_embedding_hnsw_idx
  on public.conversations
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create index conversations_user_embedding_hash_idx
  on public.conversations (user_id, embedding_input_hash)
  where embedding_input_hash is not null;

create or replace function public.match_conversations(
  query_embedding extensions.vector(1536),
  match_count integer default 10,
  match_threshold double precision default 0.7
)
returns table (
  id uuid,
  title text,
  summary text,
  started_at timestamptz,
  ended_at timestamptz,
  keywords text[],
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    conversations.id,
    conversations.title,
    conversations.summary,
    conversations.started_at,
    conversations.ended_at,
    conversations.keywords,
    1 - (conversations.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.conversations
  where conversations.user_id = (select auth.uid())
    and public.is_lifelog_owner(conversations.user_id)
    and conversations.embedding is not null
    and 1 - (conversations.embedding OPERATOR(extensions.<=>) query_embedding) >= match_threshold
  order by conversations.embedding OPERATOR(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_conversations(
  extensions.vector(1536),
  integer,
  double precision
) from public;

grant execute on function public.match_conversations(
  extensions.vector(1536),
  integer,
  double precision
) to authenticated;
