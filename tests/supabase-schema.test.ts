import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260616000000_private_owner_foundation.sql",
  "utf8",
);

test("migration creates private owner foundation tables", () => {
  for (const table of ["conversations", "transcriptions", "tasks", "sync_runs"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});

test("migration scopes RLS policies with select auth.uid", () => {
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
});

test("migration defines idempotency constraints", () => {
  assert.match(migration, /unique \(user_id, fieldy_id\)/);
  assert.match(migration, /unique \(user_id, fieldy_segment_id\)/);
  assert.match(migration, /unique \(user_id, fieldy_task_id\)/);
});

test("migration avoids raw payload columns", () => {
  assert.doesNotMatch(migration, /raw_payload/);
  assert.match(migration, /fieldy_metadata jsonb not null default '\{\}'::jsonb/);
});
