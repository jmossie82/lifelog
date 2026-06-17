import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260616000000_private_owner_foundation.sql",
  "utf8",
);

const normalizedMigration = migration.replace(/\s+/g, " ").trim();

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
