import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260616000000_private_owner_foundation.sql",
  "utf8",
);

const normalizedMigration = migration.replace(/\s+/g, " ").trim();
const ownerUsing = "using \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)";
const ownerCheck = "with check \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)";

function assertOwnerPolicy(table: string, action: "select" | "insert" | "update") {
  const policyAction = action === "select" ? "read" : action;
  const policyTableName = table.replace("_", " ");
  const basePolicyPattern = `create policy "Owner can ${policyAction} ${policyTableName}" on public\\.${table} for ${action} to authenticated`;

  assert.match(normalizedMigration, new RegExp(basePolicyPattern));

  if (action === "select") {
    assert.match(normalizedMigration, new RegExp(`${basePolicyPattern} ${ownerUsing};`));
    return;
  }

  if (action === "insert") {
    assert.match(normalizedMigration, new RegExp(`${basePolicyPattern} ${ownerCheck};`));
    return;
  }

  assert.match(
    normalizedMigration,
    new RegExp(`${basePolicyPattern} ${ownerUsing} ${ownerCheck};`),
  );
}

test("migration creates private owner foundation tables", () => {
  for (const table of ["conversations", "transcriptions", "tasks", "sync_runs"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});

test("migration scopes every owner table action with select auth.uid", () => {
  for (const table of ["conversations", "transcriptions", "tasks", "sync_runs"]) {
    assertOwnerPolicy(table, "select");
    assertOwnerPolicy(table, "insert");
    assertOwnerPolicy(table, "update");
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
