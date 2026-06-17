import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getConversationDetail,
  isUuid,
  mapConversationDetail,
} from "../lib/lifelog/conversation-detail.ts";

test("isUuid accepts canonical UUIDs only", () => {
  assert.equal(isUuid("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isUuid("00000000-0000-4000-8000-ABCDEF000001"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("00000000-0000-4000-8000-000000000001/sneaky"), false);
});

test("mapConversationDetail orders transcript rows and maps linked tasks", () => {
  const detail = mapConversationDetail({
    conversation: {
      id: "conversation-1",
      fieldy_id: "fieldy-1",
      title: null,
      summary: null,
      content: "Full content",
      started_at: "2026-06-16T10:00:00.000Z",
      ended_at: "2026-06-16T10:30:00.000Z",
      keywords: ["planning"],
      fieldy_metadata: { type: "conversation" },
    },
    transcriptions: [
      {
        id: "segment-2",
        speaker_label: null,
        text: "Second",
        started_at: "2026-06-16T10:05:00.000Z",
        ended_at: null,
      },
      {
        id: "segment-1",
        speaker_label: "Jamie",
        text: "First",
        started_at: "2026-06-16T10:01:00.000Z",
        ended_at: null,
      },
    ],
    tasks: [{ id: "task-1", title: "Send recap", status: "new", due_at: null }],
  });

  assert.equal(detail.title, "Untitled conversation");
  assert.deepEqual(detail.transcript.map((segment) => segment.text), [
    "First",
    "Second",
  ]);
  assert.equal(detail.tasks[0]?.title, "Send recap");
});

test("getConversationDetail returns null without child queries when conversation is missing", async () => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = createConversationDetailClient({
    calls,
    conversationResult: { data: null, error: null },
  });

  assert.equal(
    await getConversationDetail(
      client as never,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
    ),
    null,
  );
  assert.deepEqual(calls.map((call) => call.table), [
    "conversations",
    "conversations",
    "conversations",
  ]);
});

test("getConversationDetail filters all reads by authorized user and conversation id", async () => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = createConversationDetailClient({
    calls,
    conversationResult: {
      data: {
        id: "conversation-1",
        fieldy_id: "fieldy-1",
        title: "Planning",
        summary: "Summary",
        content: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: {},
      },
      error: null,
    },
    transcriptionsResult: { data: [], error: null },
    tasksResult: { data: [], error: null },
  });

  await getConversationDetail(
    client as never,
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000001",
  );

  assert.deepEqual(
    calls.map((call) => [call.table, call.method, call.args]),
    [
      [
        "conversations",
        "select",
        [
          "id, fieldy_id, title, summary, content, started_at, ended_at, keywords, fieldy_metadata",
        ],
      ],
      ["conversations", "eq", ["id", "00000000-0000-4000-8000-000000000001"]],
      [
        "conversations",
        "eq",
        ["user_id", "00000000-0000-4000-8000-000000000001"],
      ],
      ["transcriptions", "select", ["id, speaker_label, text, started_at, ended_at"]],
      ["transcriptions", "eq", ["conversation_id", "conversation-1"]],
      [
        "transcriptions",
        "eq",
        ["user_id", "00000000-0000-4000-8000-000000000001"],
      ],
      [
        "transcriptions",
        "order",
        ["started_at", { ascending: true, nullsFirst: false }],
      ],
      ["transcriptions", "order", ["id", { ascending: true }]],
      ["tasks", "select", ["id, title, status, due_at"]],
      ["tasks", "eq", ["conversation_id", "conversation-1"]],
      ["tasks", "eq", ["user_id", "00000000-0000-4000-8000-000000000001"]],
      ["tasks", "order", ["created_at", { ascending: false }]],
    ],
  );
});

function createConversationDetailClient({
  calls,
  conversationResult,
  transcriptionsResult = { data: [], error: null },
  tasksResult = { data: [], error: null },
}: {
  calls: Array<{ table: string; method: string; args: unknown[] }>;
  conversationResult: { data: unknown; error: unknown };
  transcriptionsResult?: { data: unknown; error: unknown };
  tasksResult?: { data: unknown; error: unknown };
}) {
  const responses = {
    conversations: conversationResult,
    transcriptions: transcriptionsResult,
    tasks: tasksResult,
  };

  return {
    from(table: "conversations" | "transcriptions" | "tasks") {
      const builder = {
        select(...args: unknown[]) {
          calls.push({ table, method: "select", args });
          return builder;
        },
        eq(...args: unknown[]) {
          calls.push({ table, method: "eq", args });
          return builder;
        },
        order(...args: unknown[]) {
          calls.push({ table, method: "order", args });
          return builder;
        },
        async maybeSingle() {
          return responses[table];
        },
        then(
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(responses[table]).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}
