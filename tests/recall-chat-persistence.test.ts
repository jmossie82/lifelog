import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRecallChatSessionTitle,
  ensureRecallChatSession,
  getRecallChatSession,
  getRecallChatMessages,
  getRecallChatSessions,
  mapRecallChatMessageRow,
  normalizeRecallChatSessionId,
  saveRecallChatTurn,
  serializeRecallChatMessageParts,
} from "../lib/lifelog/recall-chat-persistence.ts";
import type { RecallChatSourceCitation } from "../lib/lifelog/recall-chat-persistence.ts";

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

test("getRecallChatSessions queries only the owner rows ordered by recency", async () => {
  const calls: unknown[] = [];
  const supabase = createFakeSupabase(calls, {
    recall_chat_sessions: { data: [], error: null },
  });

  await getRecallChatSessions(supabase, { userId: "user-1" });

  assert.deepEqual(calls, [
    ["from", "recall_chat_sessions"],
    ["select", "id, title, latest_user_text, source_count, message_count, created_at, updated_at"],
    ["eq", "user_id", "user-1"],
    ["order", "updated_at", { ascending: false }],
    ["limit", 20],
  ]);
});

test("getRecallChatSession queries one owner session by id", async () => {
  const calls: unknown[] = [];
  const supabase = createFakeSupabase(calls, {
    recall_chat_sessions: {
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        title: "Older selected question",
        latest_user_text: "Older selected question",
        source_count: 2,
        message_count: 6,
        created_at: "2026-06-17T12:00:00.000Z",
        updated_at: "2026-06-17T12:30:00.000Z",
      },
      error: null,
    },
  });

  const session = await getRecallChatSession(supabase, {
    sessionId: "00000000-0000-4000-8000-000000000001",
    userId: "user-1",
  });

  assert.deepEqual(calls, [
    ["from", "recall_chat_sessions"],
    ["select", "id, title, latest_user_text, source_count, message_count, created_at, updated_at"],
    ["eq", "user_id", "user-1"],
    ["eq", "id", "00000000-0000-4000-8000-000000000001"],
    ["maybeSingle"],
  ]);
  assert.deepEqual(session, {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Older selected question",
    latestUserText: "Older selected question",
    sourceCount: 2,
    messageCount: 6,
    createdAt: "2026-06-17T12:00:00.000Z",
    updatedAt: "2026-06-17T12:30:00.000Z",
  });
});

test("getRecallChatSession returns null when the owner session is missing", async () => {
  const calls: unknown[] = [];
  const supabase = createFakeSupabase(calls, {
    recall_chat_sessions: { data: null, error: null },
  });

  const session = await getRecallChatSession(supabase, {
    sessionId: "00000000-0000-4000-8000-000000000099",
    userId: "user-1",
  });

  assert.equal(session, null);
  assert.deepEqual(calls, [
    ["from", "recall_chat_sessions"],
    ["select", "id, title, latest_user_text, source_count, message_count, created_at, updated_at"],
    ["eq", "user_id", "user-1"],
    ["eq", "id", "00000000-0000-4000-8000-000000000099"],
    ["maybeSingle"],
  ]);
});

test("getRecallChatSession propagates Supabase errors", async () => {
  const error = new Error("database unavailable");
  const supabase = createFakeSupabase([], {
    recall_chat_sessions: { data: null, error },
  });

  await assert.rejects(
    () =>
      getRecallChatSession(supabase, {
        sessionId: "00000000-0000-4000-8000-000000000001",
        userId: "user-1",
      }),
    error,
  );
});

test("getRecallChatMessages queries only the owner session messages ordered oldest first", async () => {
  const calls: unknown[] = [];
  const supabase = createFakeSupabase(calls, {
    recall_chat_messages: { data: [], error: null },
  });

  await getRecallChatMessages(supabase, {
    sessionId: "00000000-0000-4000-8000-000000000001",
    userId: "user-1",
  });

  assert.deepEqual(calls, [
    ["from", "recall_chat_messages"],
    ["select", "id, role, parts, source_citations, created_at"],
    ["eq", "user_id", "user-1"],
    ["eq", "session_id", "00000000-0000-4000-8000-000000000001"],
    ["order", "created_at", { ascending: true }],
    ["limit", 40],
  ]);
});

test("ensureRecallChatSession inserts a titled session when id is new", async () => {
  const calls: unknown[] = [];
  const supabase = createFakeSupabase(calls, {
    recall_chat_sessions: {
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        title: "Latest question",
        latest_user_text: "Latest question",
        source_count: 0,
        message_count: 0,
        created_at: "2026-06-18T12:00:00.000Z",
        updated_at: "2026-06-18T12:00:00.000Z",
      },
      error: null,
    },
  });

  await ensureRecallChatSession(supabase, {
    sessionId: "00000000-0000-4000-8000-000000000001",
    userId: "user-1",
    latestUserText: "Latest question",
  });

  assert.deepEqual(calls, [
    ["from", "recall_chat_sessions"],
    [
      "upsert",
      {
        id: "00000000-0000-4000-8000-000000000001",
        user_id: "user-1",
        title: "Latest question",
        latest_user_text: "Latest question",
      },
      { onConflict: "user_id,id" },
    ],
    ["select", "id, title, latest_user_text, source_count, message_count, created_at, updated_at"],
    ["single"],
  ]);
});

test("saveRecallChatTurn inserts user and assistant messages then updates the session summary", async () => {
  const calls: unknown[] = [];
  const dirtyUserText = `  ${"x".repeat(1200)}   `;
  const storedUserText = "x".repeat(1000);
  const sources = [
    { citationId: " S1 ", conversationId: " conversation-1 ", title: " Sales   call " },
    { citationId: "S2", conversationId: "conversation-2", title: "y".repeat(1200), private: "drop me" },
    { citationId: "", conversationId: "conversation-bad", title: "Missing citation id" },
    { citationId: "S3", conversationId: "conversation-3", title: "Follow-up" },
    { citationId: "S4", conversationId: "conversation-4", title: "Budget" },
    { citationId: "S5", conversationId: "conversation-5", title: "Roadmap" },
    { citationId: "S6", conversationId: "conversation-6", title: "Over cap" },
  ] as unknown as RecallChatSourceCitation[];
  const storedSources = [
    { citationId: "S1", conversationId: "conversation-1", title: "Sales call" },
    { citationId: "S2", conversationId: "conversation-2", title: "y".repeat(1000) },
    { citationId: "S3", conversationId: "conversation-3", title: "Follow-up" },
    { citationId: "S4", conversationId: "conversation-4", title: "Budget" },
    { citationId: "S5", conversationId: "conversation-5", title: "Roadmap" },
  ];
  const supabase = createFakeSupabase(calls, {
    recall_chat_messages: { data: null, error: null },
    update_recall_chat_session_summary: { data: null, error: null },
  });

  await saveRecallChatTurn(supabase, {
    userId: "user-1",
    sessionId: "00000000-0000-4000-8000-000000000001",
    latestUserText: dirtyUserText,
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "  Answer   [S1]  " },
        { type: "file", url: "file://private" },
      ],
    },
    sources,
  });

  assert.deepEqual(calls, [
    ["from", "recall_chat_messages"],
    [
      "insert",
      [
        {
          user_id: "user-1",
          session_id: "00000000-0000-4000-8000-000000000001",
          role: "user",
          parts: [{ type: "text", text: storedUserText }],
          source_citations: [],
        },
        {
          user_id: "user-1",
          session_id: "00000000-0000-4000-8000-000000000001",
          role: "assistant",
          parts: [{ type: "text", text: "Answer [S1]" }],
          source_citations: storedSources,
        },
      ],
    ],
    [
      "rpc",
      "update_recall_chat_session_summary",
      {
        session_user_id: "user-1",
        chat_session_id: "00000000-0000-4000-8000-000000000001",
        latest_user_text_value: storedUserText,
        source_count_value: 5,
        message_increment: 2,
      },
    ],
  ]);
});

function createFakeSupabase(calls: unknown[], results: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      calls.push(["from", table]);
      const result = results[table] ?? { data: null, error: null };
      const builder = {
        select(columns: string) {
          calls.push(["select", columns]);
          return builder;
        },
        insert(value: unknown) {
          calls.push(["insert", value]);
          return builder;
        },
        upsert(value: unknown, options?: unknown) {
          calls.push(["upsert", value, options]);
          return builder;
        },
        update(value: unknown) {
          calls.push(["update", value]);
          return builder;
        },
        eq(column: string, value: unknown) {
          calls.push(["eq", column, value]);
          return builder;
        },
        order(column: string, options: unknown) {
          calls.push(["order", column, options]);
          return builder;
        },
        limit(value: number) {
          calls.push(["limit", value]);
          return Promise.resolve(result);
        },
        single() {
          calls.push(["single"]);
          return Promise.resolve(result);
        },
        maybeSingle() {
          calls.push(["maybeSingle"]);
          return Promise.resolve(result);
        },
        then(resolve: (value: unknown) => void) {
          return Promise.resolve(result).then(resolve);
        },
      };
      return builder;
    },
    rpc(name: string, args: unknown) {
      calls.push(["rpc", name, args]);
      return Promise.resolve(results[name] ?? { data: null, error: null });
    },
  };
}
