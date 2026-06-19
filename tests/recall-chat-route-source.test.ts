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
  assert.match(source, /toUIMessageStreamResponse\(/);
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
  assert.match(source, /buildRecallChatModelMessagesForTurn/);
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
  const latestTextIndex = source.search(/extractLatestUserText\(clientMessages\)/);
  const storedMessagesIndex = source.search(/const storedMessages = await getRecallChatMessages/);
  const modelMessagesIndex = source.search(
    /const modelMessages = buildRecallChatModelMessagesForTurn\(\{/,
  );
  const retrievalQueryIndex = source.search(/query: latestUserText/);
  const convertIndex = source.search(/await convertToModelMessages\(modelMessages\)/);

  assert.ok(parseIndex > -1);
  assert.ok(trimIndex > -1);
  assert.ok(latestTextIndex > trimIndex);
  assert.ok(storedMessagesIndex > latestTextIndex);
  assert.ok(modelMessagesIndex > storedMessagesIndex);
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

test("recall chat route persists completed UI messages with AI SDK onFinish", () => {
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /normalizeRecallChatSessionId/);
  assert.match(source, /ensureRecallChatSession/);
  assert.match(source, /getRecallChatMessages/);
  assert.match(source, /buildRecallChatModelMessagesForTurn/);
  assert.match(source, /toUIMessageStreamResponse\(\{\s*originalMessages:/);
  assert.match(source, /generateMessageId:\s*\(\) => crypto\.randomUUID\(\)/);
  assert.match(source, /onFinish:\s*async \(\{ responseMessage, isAborted \}\)/);
  assert.match(source, /if \(isAborted\) return/);
  assert.match(source, /saveRecallChatTurn/);
  assert.match(source, /const turnId =\s*deriveRecallChatTurnId\(chatId, extractLatestClientUserMessageId\(clientMessages\)\) \?\?\s*crypto\.randomUUID\(\)/);
  assert.match(source, /turnId,/);
});

test("recall chat route does not trust raw client history for persistence or model input", () => {
  assert.doesNotMatch(source, /convertToModelMessages\(messages\)/);
  assert.doesNotMatch(source, /saveRecallChatTurn\([\s\S]*body\.messages/);
  assert.match(source, /const storedMessages = await getRecallChatMessages/);
  assert.match(source, /const modelMessages = buildRecallChatModelMessagesForTurn/);
});

test("recall chat route derives a stable uuid fallback from the AI SDK chat id", () => {
  assert.match(source, /import \{ createHash \} from "node:crypto";/);
  assert.match(source, /id\?: unknown/);
  assert.match(source, /function deriveRecallChatSessionId\(value: unknown\)/);
  assert.match(source, /RECALL_CHAT_AI_SDK_ID_PATTERN/);
  assert.match(source, /typeof value !== "string"/);
  assert.match(source, /id\.length > 128/);
  assert.match(source, /createHash\("sha256"\)\.update\(`recall-chat:\$\{id\}`\)\.digest\(\)/);
  assert.match(source, /hash\[6\] = \(hash\[6\] & 0x0f\) \| 0x50/);
  assert.match(source, /hash\[8\] = \(hash\[8\] & 0x3f\) \| 0x80/);
  assert.match(
    source,
    /const chatId =\s*normalizeRecallChatSessionId\(body\.chatId\) \?\?\s*deriveRecallChatSessionId\(body\.id\) \?\?\s*crypto\.randomUUID\(\)/,
  );
  assert.doesNotMatch(source, /sessionId:\s*body\.id/);
  assert.doesNotMatch(source, /id:\s*body\.id/);
  assert.doesNotMatch(source, /normalizeRecallChatSessionId\(body\.id\)/);
});

test("recall chat route derives a stable turn id from the latest client user message id", () => {
  assert.match(source, /function extractLatestClientUserMessageId/);
  assert.match(source, /message\?\.role !== "user"/);
  assert.match(source, /typeof message\.id !== "string"/);
  assert.match(source, /!hasTextPart\(message\.parts\)/);
  assert.match(source, /function deriveRecallChatTurnId\(sessionId: string, clientMessageId: string \| null\)/);
  assert.match(source, /recall-chat-turn:\$\{sessionId\}:\$\{clientMessageId\}/);
  assert.match(source, /hash\[6\] = \(hash\[6\] & 0x0f\) \| 0x50/);
  assert.match(source, /hash\[8\] = \(hash\[8\] & 0x3f\) \| 0x80/);
});

test("recall chat route emits only the resolved chat id as stream metadata", () => {
  const metadataMatch = source.match(
    /messageMetadata:\s*\(\{ part \}\) => \{([\s\S]*?)\n      \},\n      onFinish:/,
  );

  assert.ok(metadataMatch);

  const metadataSource = metadataMatch[1] ?? "";

  assert.match(metadataSource, /if \(part\.type !== "start" && part\.type !== "finish"\) return/);
  assert.match(metadataSource, /return \{ chatId \}/);
  assert.doesNotMatch(metadataSource, /userId/);
  assert.doesNotMatch(metadataSource, /user\.id/);
  assert.doesNotMatch(metadataSource, /sources/);
  assert.doesNotMatch(metadataSource, /sourceCitations/);
  assert.doesNotMatch(metadataSource, /latestUserText/);
  assert.doesNotMatch(metadataSource, /recallAnswerModel/);
  assert.doesNotMatch(metadataSource, /openAiApiKey/);
});
