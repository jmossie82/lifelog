import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/actions/embed-conversations.ts", "utf8");
const stateSource = readFileSync("lib/lifelog/embed-action-state.ts", "utf8");

test("embed conversations action is server-only and owner protected", () => {
  assert.match(source, /"use server";/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /const ownerUserId = getOwnerUserId\(\)/);
  assert.match(source, /user\.id !== ownerUserId/);
  assert.match(source, /createSupabaseAdminClient\(\)/);
  assert.match(source, /createOpenAiEmbeddingClient/);
  assert.match(source, /embedMissingConversations/);
  assert.match(source, /revalidatePath\("\/"\)/);
  assert.doesNotMatch(source, /console\.(?:debug|error|info|log|warn)/);
});

test("embed conversations action creates privileged clients only after owner authorization", () => {
  const authIndex = source.indexOf("auth.getUser()");
  const ownerCheckIndex = source.indexOf("user.id !== ownerUserId");
  const adminClientIndex = source.indexOf("createSupabaseAdminClient()");
  const openAiEnvIndex = source.indexOf("getOpenAiEmbeddingEnv()");

  assert.ok(authIndex > -1);
  assert.ok(ownerCheckIndex > authIndex);
  assert.ok(adminClientIndex > ownerCheckIndex);
  assert.ok(openAiEnvIndex > ownerCheckIndex);
});

test("embed conversations action exposes useActionState-compatible state", () => {
  assert.match(stateSource, /export type EmbedConversationsActionState/);
  assert.match(stateSource, /status: "idle" \| "success" \| "error"/);
  assert.match(stateSource, /embeddedCount: number \| null/);
  assert.match(stateSource, /skippedCount: number \| null/);
  assert.match(stateSource, /export const initialEmbedConversationsActionState/);
  assert.match(
    source,
    /embedConversations\(\s*_previousState: EmbedConversationsActionState,\s*_formData: FormData,\s*\): Promise<EmbedConversationsActionState>/,
  );
});

test("embed conversations action returns safe errors without raw secrets", () => {
  assert.match(source, /catch \{/);
  assert.match(source, /Conversation embedding failed\. Check configuration and try again\./);
  assert.doesNotMatch(source, /catch\s*\([^)]*(?:error|err|e)[^)]*\)[\s\S]*message:\s*(?:error|err|e)\.message/);
  assert.doesNotMatch(source, /message:\s*.*openAiApiKey/);
  assert.doesNotMatch(source, /message:\s*.*OPENAI_API_KEY/);
});
