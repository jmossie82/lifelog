import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/api/recall-chat/route.ts", "utf8");

test("recall chat route streams UI messages with AI SDK 6", () => {
  assert.match(source, /import \{ openai \} from "@ai-sdk\/openai";/);
  assert.match(source, /convertToModelMessages/);
  assert.match(source, /streamText/);
  assert.match(source, /export const maxDuration = 30/);
  assert.match(source, /streamText\(\{/);
  assert.match(source, /await convertToModelMessages\(/);
  assert.match(source, /toUIMessageStreamResponse\(\)/);
  assert.doesNotMatch(source, /import \{[^}]*toUIMessageStream/);
});

test("recall chat route enforces owner auth before retrieval", () => {
  assert.match(source, /createSupabaseServerClient/);
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /getOwnerUserId\(\)/);
  assert.match(source, /user\.id !== getOwnerUserId\(\)/);
  assert.match(source, /Response\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\)/);

  const authIndex = source.search(/supabase\.auth\.getUser\(\)/);
  const ownerCheckIndex = source.search(/user\.id !== getOwnerUserId\(\)/);
  const retrievalIndex = source.search(/searchSemanticRecall\(\{/);

  assert.ok(authIndex > -1);
  assert.ok(ownerCheckIndex > authIndex);
  assert.ok(retrievalIndex > ownerCheckIndex);
});

test("recall chat route retrieves private lifelog context", () => {
  assert.match(source, /parseRecallChatMessages/);
  assert.match(source, /trimRecallChatHistory/);
  assert.match(source, /extractLatestUserText/);
  assert.match(source, /normalizeRecallQuery/);
  assert.match(source, /buildRecallChatModelMessagesFromText/);
  assert.match(source, /getOpenAiEmbeddingEnv\(\)/);
  assert.match(source, /getOpenAiRecallEnv\(\)/);
  assert.match(source, /searchSemanticRecall/);
  assert.match(source, /createOpenAiEmbeddingClient/);
  assert.match(source, /embedText/);
  assert.match(source, /buildGroundedRecallSources/);
  assert.match(source, /buildRecallChatSystemPrompt/);
});

test("recall chat route rebuilds safe text-only messages before model conversion", () => {
  const parseIndex = source.search(/parseRecallChatMessages\(body\.messages\)/);
  const trimIndex = source.search(/trimRecallChatHistory\(/);
  const latestTextIndex = source.search(
    /const latestUserText = normalizeRecallQuery\(extractLatestUserText\(messages\)\)/,
  );
  const modelMessagesIndex = source.search(
    /const modelMessages = buildRecallChatModelMessagesFromText\(latestUserText\)/,
  );
  const retrievalQueryIndex = source.search(/query: latestUserText/);
  const convertIndex = source.search(/await convertToModelMessages\(modelMessages\)/);

  assert.ok(parseIndex > -1);
  assert.ok(trimIndex > -1);
  assert.ok(latestTextIndex > trimIndex);
  assert.ok(modelMessagesIndex > latestTextIndex);
  assert.ok(retrievalQueryIndex > modelMessagesIndex);
  assert.ok(convertIndex > modelMessagesIndex);
  assert.doesNotMatch(source, /convertToModelMessages\(messages/);
  assert.doesNotMatch(source, /convertToModelMessages\(body\.messages/);
});

test("recall chat route returns safe errors without raw private details", () => {
  assert.match(source, /catch\s*\(\s*error\s*\)\s*\{/);
  assert.match(source, /getRecallChatSafeErrorMessage\(error\)/);
  assert.match(
    source,
    /Response\.json\(\s*\{ error: getRecallChatSafeErrorMessage\(error\) \},\s*\{ status: 500 \},?\s*\)/,
  );
  assert.doesNotMatch(source, /console\.log\(/);
  assert.doesNotMatch(source, /OPENAI_API_KEY[\s\S]*Response\.json/);
});
