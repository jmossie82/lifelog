import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = [
  readFileSync("app/actions/backfill-fieldy.ts", "utf8"),
  readFileSync("app/actions/backfill-fieldy-core.ts", "utf8"),
].join("\n");

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

test("backfill action fails closed instead of falling back to the whole range for transcripts", () => {
  assert.doesNotMatch(source, /conversation\.startTime\s*\?\?/);
  assert.doesNotMatch(source, /conversation\.endTime\s*\?\?/);
  assert.match(source, /Fieldy backfill encountered an unbounded conversation/);
});

test("backfill action records partial imported count on failure", () => {
  const importedCountDeclaration = source.indexOf("let importedCount = 0");
  const tryBlock = source.indexOf("try {");
  const failureUpdate = source.indexOf('status: "failed"');

  assert.notEqual(importedCountDeclaration, -1);
  assert.notEqual(tryBlock, -1);
  assert.notEqual(failureUpdate, -1);
  assert.ok(importedCountDeclaration < tryBlock);
  assert.match(
    source.slice(failureUpdate),
    /status: "failed"[\s\S]*importedCount,/,
  );
  assert.doesNotMatch(
    source.slice(failureUpdate),
    /status: "failed"[\s\S]*importedCount: 0/,
  );
});

test("backfill action counts every ingested row", () => {
  assert.match(
    source,
    /importedCount \+=\s*result\.conversationCount \+\s*result\.transcriptionCount \+\s*result\.taskCount/,
  );
});

const actionSource = readFileSync("app/actions/backfill-fieldy.ts", "utf8");
const stateSource = readFileSync("lib/lifelog/backfill-action-state.ts", "utf8");

test("backfill action exposes useActionState-compatible state", () => {
  assert.match(stateSource, /export type BackfillActionState/);
  assert.match(stateSource, /status: "idle" \| "success" \| "error"/);
  assert.match(stateSource, /export const initialBackfillActionState/);
  assert.match(
    actionSource,
    /type BackfillActionReturn<TFormData> = Promise<\s*TFormData extends FormData \? BackfillActionState : void\s*>/,
  );
  assert.match(
    actionSource,
    /backfillFieldy<[\s\S]*TFormData extends FormData \| undefined = undefined,[\s\S]*_prevStateOrFormData: BackfillActionState \| FormData,\s*_formData\?: TFormData/,
  );
  assert.match(actionSource, /return \{\s*status: "success"/);
  assert.match(actionSource, /return \{\s*status: "error"/);
  assert.doesNotMatch(actionSource, /export const initialBackfillActionState/);
});
