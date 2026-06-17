import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildConversationEmbeddingInput,
  CONVERSATION_EMBEDDING_MAX_CHARS,
  hashConversationEmbeddingInput,
} from "../lib/lifelog/embedding-input.ts";

const conversation = {
  id: "00000000-0000-4000-8000-000000000001",
  fieldyId: "fieldy-conversation-1",
  title: "Budget meeting",
  summary: "We discussed next quarter planning.",
  content: "Full notes from the meeting.",
  keywords: ["budget", "planning"],
  transcript: [
    {
      speakerLabel: "Jamie",
      text: "We need to finish the proposal.",
      startedAt: "2026-06-17T15:00:00.000Z",
    },
    {
      speakerLabel: "Alex",
      text: "I will send the numbers.",
      startedAt: "2026-06-17T15:01:00.000Z",
    },
  ],
};

test("buildConversationEmbeddingInput creates deterministic bounded text", () => {
  assert.equal(
    buildConversationEmbeddingInput(conversation),
    [
      "Title: Budget meeting",
      "Summary: We discussed next quarter planning.",
      "Keywords: budget, planning",
      "Content: Full notes from the meeting.",
      "Transcript:",
      "Speaker 1: We need to finish the proposal.",
      "Speaker 2: I will send the numbers.",
    ].join("\n"),
  );
});

test("buildConversationEmbeddingInput omits owner and Fieldy identifiers", () => {
  const input = buildConversationEmbeddingInput(conversation);

  assert.doesNotMatch(input, /00000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(input, /fieldy-conversation-1/);
  assert.doesNotMatch(input, /Jamie/);
  assert.doesNotMatch(input, /Alex/);
});

test("buildConversationEmbeddingInput normalizes whitespace and skips empty fields", () => {
  assert.equal(
    buildConversationEmbeddingInput({
      ...conversation,
      title: "  Budget\n\nmeeting  ",
      summary: "",
      content: null,
      keywords: ["  budget\tplanning  ", ""],
      transcript: [
        { speakerLabel: null, text: "  First\nline  ", startedAt: null },
        { speakerLabel: "   ", text: "   ", startedAt: null },
      ],
    }),
    [
      "Title: Budget meeting",
      "Keywords: budget planning",
      "Transcript:",
      "Speaker: First line",
    ].join("\n"),
  );
});

test("buildConversationEmbeddingInput caps very long text", () => {
  const input = buildConversationEmbeddingInput({
    ...conversation,
    content: "a".repeat(CONVERSATION_EMBEDDING_MAX_CHARS * 2),
    transcript: [],
  });

  assert.equal(input.length, CONVERSATION_EMBEDDING_MAX_CHARS);
});

test("buildConversationEmbeddingInput returns empty text for empty conversations", () => {
  assert.equal(
    buildConversationEmbeddingInput({
      id: "00000000-0000-4000-8000-000000000001",
      fieldyId: "fieldy-conversation-1",
      title: "",
      summary: "",
      content: null,
      keywords: ["  "],
      transcript: [{ speakerLabel: "Jamie", text: "   ", startedAt: null }],
    }),
    "",
  );
});

test("hashConversationEmbeddingInput is stable for unchanged input", () => {
  const input = buildConversationEmbeddingInput(conversation);
  const first = hashConversationEmbeddingInput({
    input,
    embeddingModel: "text-embedding-3-small",
    inputVersion: 1,
  });
  const second = hashConversationEmbeddingInput({
    input,
    embeddingModel: "text-embedding-3-small",
    inputVersion: 1,
  });

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("hashConversationEmbeddingInput changes when model or input version changes", () => {
  const input = buildConversationEmbeddingInput(conversation);
  const first = hashConversationEmbeddingInput({
    input,
    embeddingModel: "text-embedding-3-small",
    inputVersion: 1,
  });

  assert.notEqual(
    first,
    hashConversationEmbeddingInput({
      input,
      embeddingModel: "text-embedding-3-large",
      inputVersion: 1,
    }),
  );
  assert.notEqual(
    first,
    hashConversationEmbeddingInput({
      input,
      embeddingModel: "text-embedding-3-small",
      inputVersion: 2,
    }),
  );
});
