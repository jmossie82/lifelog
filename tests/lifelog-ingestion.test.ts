import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createIngestionService,
  normalizeConversation,
  type IngestionSupabase,
} from "../lib/lifelog/ingestion.ts";
import { deriveFieldyTaskId } from "../lib/lifelog/idempotency.ts";

function createSupabaseTableRecorder({
  conversationResult = {
    data: { id: "local-conversation-1", fieldy_id: "conversation-1" },
    error: null,
  },
}: {
  conversationResult?: {
    data: { id: string; fieldy_id: string } | null;
    error: Error | null;
  };
} = {}) {
  const calls: Array<{
    table: string;
    rows: Array<Record<string, unknown>>;
    options: unknown;
  }> = [];

  return {
    calls,
    client: {
      from(table: string) {
        return {
          upsert(rows: unknown | unknown[], options?: unknown) {
            const normalizedRows = (Array.isArray(rows) ? rows : [rows]) as Array<Record<string, unknown>>;
            calls.push({
              table,
              rows: normalizedRows,
              options,
            });

            const result = table === "conversations" ? conversationResult : { data: normalizedRows, error: null };

            return {
              select() {
                return {
                  single: async () => result,
                };
              },
              then(resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) {
                return Promise.resolve(result).then(resolve, reject);
              },
            };
          },
        };
      },
    },
  };
}

test("normalizeConversation maps canonical Fieldy records into minimized rows", () => {
  assert.deepEqual(
    normalizeConversation({
      ownerUserId: "owner-1",
      conversation: {
        id: "conversation-1",
        title: "Standup",
        summary: "Launch status",
        content: "Launch is on track.",
        keywords: ["launch"],
        startTime: "2026-06-16T15:00:00.000Z",
        endTime: "2026-06-16T15:30:00.000Z",
        location: "HQ",
        calendarEventId: "calendar-event-1",
      },
    }),
    {
      user_id: "owner-1",
      fieldy_id: "conversation-1",
      title: "Standup",
      summary: "Launch status",
      content: "Launch is on track.",
      keywords: ["launch"],
      started_at: "2026-06-16T15:00:00.000Z",
      ended_at: "2026-06-16T15:30:00.000Z",
      fieldy_metadata: {
        type: null,
        templateId: null,
        updatedAt: null,
      },
    },
  );
});

test("ingestConversationSet upserts conversation, transcriptions, and tasks idempotently", async () => {
  const recorder = createSupabaseTableRecorder();
  const service = createIngestionService({
    supabase: recorder.client as unknown as IngestionSupabase,
    ownerUserId: "owner-1",
  });

  const result = await service.ingestConversationSet({
    conversation: {
      id: "conversation-1",
      title: "Standup",
      summary: "Launch status",
      content: "Launch is on track.",
      keywords: ["launch"],
      startTime: "2026-06-16T15:00:00.000Z",
      endTime: "2026-06-16T15:30:00.000Z",
    },
    transcriptions: [
      {
        text: "Launch is on track.",
        speaker: "Alex",
        start: 5,
        end: 9,
      },
    ],
    tasks: [
      {
        title: "Send launch notes",
        date: "2026-06-17T15:00:00.000Z",
        status: "new",
        memoryId: "conversation-1",
      },
    ],
  });

  assert.deepEqual(result, {
    conversationCount: 1,
    transcriptionCount: 1,
    taskCount: 1,
  });
  assert.deepEqual(
    recorder.calls.map((call) => call.table),
    ["conversations", "transcriptions", "tasks"],
  );
  assert.deepEqual(recorder.calls[0]?.options, {
    onConflict: "user_id,fieldy_id",
  });
  assert.deepEqual(recorder.calls[1]?.options, {
    onConflict: "user_id,fieldy_segment_id",
  });
  assert.deepEqual(recorder.calls[2]?.options, {
    onConflict: "user_id,fieldy_task_id",
  });
  assert.deepEqual(recorder.calls[0]?.rows[0], {
    user_id: "owner-1",
    fieldy_id: "conversation-1",
    title: "Standup",
    summary: "Launch status",
    content: "Launch is on track.",
    keywords: ["launch"],
    started_at: "2026-06-16T15:00:00.000Z",
    ended_at: "2026-06-16T15:30:00.000Z",
    fieldy_metadata: {
      type: null,
      templateId: null,
      updatedAt: null,
    },
  });
  assert.deepEqual(recorder.calls[1]?.rows[0], {
    user_id: "owner-1",
    conversation_id: "local-conversation-1",
    fieldy_segment_id: recorder.calls[1]?.rows[0]?.fieldy_segment_id,
    speaker_label: "Alex",
    text: "Launch is on track.",
    started_at: "2026-06-16T15:00:05.000Z",
    ended_at: "2026-06-16T15:00:09.000Z",
  });
  assert.deepEqual(recorder.calls[2]?.rows[0], {
    user_id: "owner-1",
    conversation_id: "local-conversation-1",
    fieldy_task_id: recorder.calls[2]?.rows[0]?.fieldy_task_id,
    title: "Send launch notes",
    status: "new",
    due_at: "2026-06-17T15:00:00.000Z",
    fieldy_metadata: {
      memoryId: "conversation-1",
      completionDate: null,
      cancellationDate: null,
    },
  });
});

test("ingestConversationSet leaves task conversation_id null when memoryId does not match", async () => {
  const recorder = createSupabaseTableRecorder();
  const service = createIngestionService({
    supabase: recorder.client as unknown as IngestionSupabase,
    ownerUserId: "owner-1",
  });

  const task = {
    title: "Review unrelated notes",
    status: "new" as const,
    memoryId: "conversation-2",
  };

  await service.ingestConversationSet({
    conversation: {
      id: "conversation-1",
      title: "Standup",
    },
    tasks: [task],
  });

  assert.equal(recorder.calls[1]?.table, "tasks");
  assert.equal(recorder.calls[1]?.rows[0]?.conversation_id, null);
  assert.equal(
    recorder.calls[1]?.rows[0]?.fieldy_task_id,
    deriveFieldyTaskId("conversation-2", task),
  );
  assert.deepEqual(recorder.calls[1]?.options, {
    onConflict: "user_id,fieldy_task_id",
  });
});

test("ingestConversationSet throws when conversation upsert returns no row", async () => {
  const recorder = createSupabaseTableRecorder({
    conversationResult: {
      data: null,
      error: null,
    },
  });
  const service = createIngestionService({
    supabase: recorder.client as unknown as IngestionSupabase,
    ownerUserId: "owner-1",
  });

  await assert.rejects(
    () =>
      service.ingestConversationSet({
        conversation: {
          id: "conversation-1",
          title: "Standup",
        },
      }),
    /Conversation upsert returned no row/,
  );
});

test("ingestConversationSet propagates conversation upsert errors", async () => {
  const expectedError = new Error("upsert failed");
  const recorder = createSupabaseTableRecorder({
    conversationResult: {
      data: null,
      error: expectedError,
    },
  });
  const service = createIngestionService({
    supabase: recorder.client as unknown as IngestionSupabase,
    ownerUserId: "owner-1",
  });

  await assert.rejects(
    () =>
      service.ingestConversationSet({
        conversation: {
          id: "conversation-1",
          title: "Standup",
        },
      }),
    expectedError,
  );
});
