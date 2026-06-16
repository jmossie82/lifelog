import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/actions/backfill-fieldy.ts", "utf8");

test("backfill action verifies owner with getUser", () => {
  assert.match(source, /"use server"/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /getOwnerUserId/);
});

test("backfill action uses Fieldy pagination and ingestion", () => {
  assert.match(source, /fetchConversations/);
  assert.match(source, /fetchTranscriptions/);
  assert.match(source, /fetchTasks/);
  assert.match(source, /ingestConversationSet/);
});

test("backfill action revalidates the dashboard", () => {
  assert.match(source, /revalidatePath\("\/"\)/);
});
