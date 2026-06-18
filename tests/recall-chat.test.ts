import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECALL_CHAT_MAX_HISTORY_MESSAGES,
  RECALL_CHAT_MAX_USER_TEXT_LENGTH,
  buildRecallChatSystemPrompt,
  extractLatestUserText,
  getRecallChatSafeErrorMessage,
  trimRecallChatHistory,
} from "../lib/lifelog/recall-chat.ts";

const userMessage = (id: string, text: string) => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const assistantMessage = (id: string, text: string) => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

test("extractLatestUserText reads the latest user text part", () => {
  const text = extractLatestUserText([
    userMessage("1", "first question"),
    assistantMessage("2", "answer"),
    userMessage("3", "  what did I promise about invoices?  "),
  ]);

  assert.equal(text, "what did I promise about invoices?");
});

test("extractLatestUserText caps long input and ignores non-text content", () => {
  const text = extractLatestUserText([
    {
      id: "1",
      role: "user",
      parts: [
        { type: "file", mediaType: "text/plain", url: "file://local" },
        { type: "text", text: "x".repeat(RECALL_CHAT_MAX_USER_TEXT_LENGTH + 50) },
      ],
    },
  ]);

  assert.equal(text.length, RECALL_CHAT_MAX_USER_TEXT_LENGTH);
});

test("extractLatestUserText returns empty string when there is no user text", () => {
  assert.equal(extractLatestUserText([assistantMessage("1", "hello")]), "");
});

test("trimRecallChatHistory keeps the most recent bounded history", () => {
  const messages = Array.from({ length: RECALL_CHAT_MAX_HISTORY_MESSAGES + 4 }, (_, index) =>
    index % 2 === 0
      ? userMessage(String(index), `question ${index}`)
      : assistantMessage(String(index), `answer ${index}`),
  );

  const trimmed = trimRecallChatHistory(messages);

  assert.equal(trimmed.length, RECALL_CHAT_MAX_HISTORY_MESSAGES);
  assert.equal(trimmed[0]?.id, "4");
  assert.equal(trimmed.at(-1)?.id, String(RECALL_CHAT_MAX_HISTORY_MESSAGES + 3));
});

test("buildRecallChatSystemPrompt embeds only bounded cited source fields", () => {
  const prompt = buildRecallChatSystemPrompt([
    {
      citationId: "S1",
      conversationId: "conversation-1",
      title: "Invoice follow-up",
      summary: "Discussed sending the June invoice.",
      startedAt: "2026-06-17T14:00:00.000Z",
      keywords: ["invoice", "follow-up"],
      similarity: 0.91,
    },
  ]);

  assert.match(prompt, /Answer only from the provided private lifelog sources/);
  assert.match(prompt, /\[S1\]/);
  assert.match(prompt, /Invoice follow-up/);
  assert.match(prompt, /Discussed sending the June invoice/);
  assert.doesNotMatch(prompt, /conversation-1/);
});

test("getRecallChatSafeErrorMessage avoids raw private details", () => {
  const message = getRecallChatSafeErrorMessage(
    new Error("OPENAI_API_KEY sk-test-owner raw transcript failed"),
  );

  assert.equal(message, "Recall Chat failed. Try again or use dashboard search.");
});
