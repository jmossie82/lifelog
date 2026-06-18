import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRecallChatSessionTitle,
  mapRecallChatMessageRow,
  normalizeRecallChatSessionId,
  serializeRecallChatMessageParts,
} from "../lib/lifelog/recall-chat-persistence.ts";

test("normalizeRecallChatSessionId accepts only UUID values", () => {
  assert.equal(
    normalizeRecallChatSessionId("00000000-0000-4000-8000-000000000001"),
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(normalizeRecallChatSessionId("not-a-uuid"), null);
  assert.equal(normalizeRecallChatSessionId(null), null);
  assert.equal(normalizeRecallChatSessionId(undefined), null);
});

test("createRecallChatSessionTitle creates a short safe title", () => {
  assert.equal(
    createRecallChatSessionTitle(
      "  What did I promise in the June sales call about invoices and follow-up?  ",
    ),
    "What did I promise in the June sales call about invoices and follow-up?",
  );
  assert.equal(createRecallChatSessionTitle("x".repeat(90)), `${"x".repeat(57)}...`);
  assert.equal(createRecallChatSessionTitle(""), "New Recall chat");
});

test("serializeRecallChatMessageParts stores bounded text parts only", () => {
  assert.deepEqual(
    serializeRecallChatMessageParts([
      { type: "text", text: "  hello   there " },
      { type: "file", url: "file://private" },
      { type: "text", text: "x".repeat(1200) },
    ]),
    [
      { type: "text", text: "hello there" },
      { type: "text", text: "x".repeat(1000) },
    ],
  );
});

test("mapRecallChatMessageRow returns a UI message with safe text parts", () => {
  assert.deepEqual(
    mapRecallChatMessageRow({
      id: "message-1",
      role: "assistant",
      parts: [{ type: "text", text: "Answer [S1]" }],
      source_citations: [{ citationId: "S1", conversationId: "conversation-1", title: "Sales call" }],
      created_at: "2026-06-18T12:00:00.000Z",
      session_id: "session-1",
      user_id: "user-1",
    }),
    {
      id: "message-1",
      role: "assistant",
      parts: [{ type: "text", text: "Answer [S1]" }],
    },
  );
});
