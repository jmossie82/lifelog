import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260616000000_private_owner_foundation.sql",
  "utf8",
);

const normalizedMigration = migration.replace(/\s+/g, " ").trim();

const semanticRecallMigration = readFileSync(
  "supabase/migrations/20260617000000_semantic_recall_v1.sql",
  "utf8",
);

const normalizedSemanticRecallMigration = semanticRecallMigration
  .replace(/\s+/g, " ")
  .trim();

const recallChatPersistenceMigration = readFileSync(
  "supabase/migrations/20260618000000_recall_chat_persistence_v1.sql",
  "utf8",
);

const normalizedRecallChatPersistenceMigration =
  recallChatPersistenceMigration.replace(/\s+/g, " ").trim();

function assertOwnerReadPolicy(table: string) {
  const policyTableName = table.replace("_", " ");
  const basePolicyPattern = `create policy "Owner can read ${policyTableName}" on public\\.${table} for select to authenticated`;

  assert.match(
    normalizedMigration,
    new RegExp(`${basePolicyPattern} using \\(public\\.is_lifelog_owner\\(user_id\\)\\);`),
  );
}

test("migration creates private owner foundation tables", () => {
  for (const table of ["conversations", "transcriptions", "tasks", "sync_runs"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});

test("migration creates a private configured-owner guard", () => {
  assert.match(migration, /create table public\.lifelog_owner_config/);
  assert.match(migration, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /constraint lifelog_owner_config_single_row check \(id = 1\)/);
  assert.match(
    migration,
    /create or replace function public\.is_lifelog_owner\(row_user_id uuid\)/,
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /\(select auth\.uid\(\)\) = row_user_id/);
  assert.match(migration, /from public\.lifelog_owner_config/);
  assert.match(
    normalizedMigration,
    /revoke all on function public\.is_lifelog_owner\(uuid\) from public;/,
  );
  assert.match(
    normalizedMigration,
    /grant execute on function public\.is_lifelog_owner\(uuid\) to authenticated;/,
  );
  assert.doesNotMatch(
    normalizedMigration,
    /grant execute on function public\.is_lifelog_owner\(uuid\) to public;/,
  );
  assert.match(migration, /alter table public\.lifelog_owner_config enable row level security/);
  assert.doesNotMatch(migration, /create policy "[^"]+"[\s\S]*on public\.lifelog_owner_config/);
});

test("migration scopes owner data reads to the configured owner only", () => {
  for (const table of ["conversations", "transcriptions", "tasks", "sync_runs"]) {
    assertOwnerReadPolicy(table);
    assert.doesNotMatch(
      normalizedMigration,
      new RegExp(`create policy "[^"]+" on public\\.${table} for insert to authenticated`),
    );
    assert.doesNotMatch(
      normalizedMigration,
      new RegExp(`create policy "[^"]+" on public\\.${table} for update to authenticated`),
    );
  }
});

test("migration defines idempotency constraints", () => {
  assert.match(migration, /unique \(user_id, fieldy_id\)/);
  assert.match(migration, /unique \(user_id, fieldy_segment_id\)/);
  assert.match(migration, /unique \(user_id, fieldy_task_id\)/);
});

test("migration enforces owner-matched conversation relationships", () => {
  assert.match(normalizedMigration, /unique \(user_id, id\)/);
  assert.match(
    normalizedMigration,
    /foreign key \(user_id, conversation_id\) references public\.conversations\(user_id, id\) on delete cascade/,
  );
  assert.match(
    normalizedMigration,
    /foreign key \(user_id, conversation_id\) references public\.conversations\(user_id, id\) on delete set null \(conversation_id\)/,
  );
});

test("migration avoids raw payload columns", () => {
  assert.doesNotMatch(migration, /raw_payload/);
  assert.match(migration, /fieldy_metadata jsonb not null default '\{\}'::jsonb/);
});

test("semantic recall migration enables pgvector and conversation embeddings", () => {
  assert.match(
    normalizedSemanticRecallMigration,
    /create extension if not exists vector with schema extensions;/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /alter table public\.conversations add column embedding extensions\.vector\(1536\)/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /add column embedding_model text/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /add column embedding_input_hash text/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /add column embedded_at timestamptz/,
  );
});

test("semantic recall match rpc keeps results owner scoped", () => {
  assert.match(
    normalizedSemanticRecallMigration,
    /create or replace function public\.match_conversations/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /query_embedding extensions\.vector\(1536\)/,
  );
  assert.match(normalizedSemanticRecallMigration, /match_count integer/);
  assert.match(normalizedSemanticRecallMigration, /match_threshold double precision/);
  assert.match(
    normalizedSemanticRecallMigration,
    /where conversations\.user_id = \(select auth\.uid\(\)\)/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /and public\.is_lifelog_owner\(conversations\.user_id\)/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /1 - \(conversations\.embedding OPERATOR\(extensions\.<=>\) query_embedding\) as similarity/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /revoke all on function public\.match_conversations\( extensions\.vector\(1536\), integer, double precision \) from public;/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /grant execute on function public\.match_conversations/,
  );
  assert.doesNotMatch(
    normalizedSemanticRecallMigration,
    /grant execute on function public\.match_conversations[^;]+to public;/,
  );
});

test("recall chat persistence migration creates owner-scoped tables", () => {
  assert.match(recallChatPersistenceMigration, /create table public\.recall_chat_sessions/);
  assert.match(recallChatPersistenceMigration, /create table public\.recall_chat_messages/);
  assert.match(recallChatPersistenceMigration, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(recallChatPersistenceMigration, /unique \(user_id, id\)/);
  assert.match(
    normalizedRecallChatPersistenceMigration,
    /foreign key \(user_id, session_id\) references public\.recall_chat_sessions\(user_id, id\) on delete cascade/,
  );
  assert.match(recallChatPersistenceMigration, /role text not null check \(role in \('user', 'assistant'\)\)/);
  assert.match(recallChatPersistenceMigration, /parts jsonb not null/);
  assert.match(recallChatPersistenceMigration, /source_citations jsonb not null default '\[\]'::jsonb/);
  assert.doesNotMatch(recallChatPersistenceMigration, /raw_prompt/);
  assert.doesNotMatch(recallChatPersistenceMigration, /api_key/);
});

test("recall chat persistence migration enables owner-only RLS writes", () => {
  for (const table of ["recall_chat_sessions", "recall_chat_messages"]) {
    assert.match(
      recallChatPersistenceMigration,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
    assert.match(
      normalizedRecallChatPersistenceMigration,
      new RegExp(`on public\\.${table} for select to authenticated using \\(public\\.is_lifelog_owner\\(user_id\\)\\);`),
    );
    assert.match(
      normalizedRecallChatPersistenceMigration,
      new RegExp(`on public\\.${table} for insert to authenticated with check \\(public\\.is_lifelog_owner\\(user_id\\)\\);`),
    );
    assert.match(
      normalizedRecallChatPersistenceMigration,
      new RegExp(`on public\\.${table} for update to authenticated using \\(public\\.is_lifelog_owner\\(user_id\\)\\) with check \\(public\\.is_lifelog_owner\\(user_id\\)\\);`),
    );
    assert.doesNotMatch(
      normalizedRecallChatPersistenceMigration,
      new RegExp(`grant [^;]+ on (?:table )?public\\.${table}[^;]*\\bto\\b[^;]*\\bpublic\\b[^;]*;`),
    );
    assert.doesNotMatch(
      normalizedRecallChatPersistenceMigration,
      /grant [^;]+ on all tables in schema public [^;]*\bto\b[^;]*\bpublic\b[^;]*;/,
    );
    assert.doesNotMatch(
      normalizedRecallChatPersistenceMigration,
      new RegExp(`create policy [^;]+ on public\\.${table}[^;]*\\bto public\\b[^;]*;`),
    );
  }
});

test("recall chat persistence migration defines ordered idempotent message storage", () => {
  assert.match(recallChatPersistenceMigration, /turn_id uuid not null/);
  assert.match(recallChatPersistenceMigration, /message_order integer not null check \(message_order > 0\)/);
  assert.match(recallChatPersistenceMigration, /unique \(session_id, turn_id, role\)/);
  assert.match(recallChatPersistenceMigration, /unique \(session_id, message_order\)/);
  assert.match(
    recallChatPersistenceMigration,
    /create index recall_chat_messages_session_order_idx/,
  );
});

test("recall chat persistence migration defines owner-checked atomic turn save rpc", () => {
  assert.match(
    recallChatPersistenceMigration,
    /create or replace function public\.save_recall_chat_turn/,
  );
  assert.match(recallChatPersistenceMigration, /language plpgsql/);
  assert.match(recallChatPersistenceMigration, /security invoker/);
  assert.match(recallChatPersistenceMigration, /set search_path = ''/);
  assert.match(recallChatPersistenceMigration, /for update/);
  assert.match(recallChatPersistenceMigration, /insert into public\.recall_chat_messages/);
  assert.match(recallChatPersistenceMigration, /on conflict \(session_id, turn_id, role\) do nothing/);
  assert.match(recallChatPersistenceMigration, /get diagnostics inserted_message_count = row_count/);
  assert.match(recallChatPersistenceMigration, /message_count = public\.recall_chat_sessions\.message_count \+ inserted_message_count/);
  assert.match(recallChatPersistenceMigration, /where id = chat_session_id/);
  assert.match(recallChatPersistenceMigration, /and user_id = session_user_id/);
  assert.match(recallChatPersistenceMigration, /and public\.is_lifelog_owner\(session_user_id\)/);
  assert.match(
    recallChatPersistenceMigration,
    /revoke all on function public\.save_recall_chat_turn\(uuid, uuid, uuid, text, integer, jsonb, jsonb, jsonb\) from public;/,
  );
  assert.match(
    recallChatPersistenceMigration,
    /grant execute on function public\.save_recall_chat_turn\(uuid, uuid, uuid, text, integer, jsonb, jsonb, jsonb\) to authenticated;/,
  );
});
