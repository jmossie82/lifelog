import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createIngestionService,
  normalizeConversation,
  type IngestionSupabase,
} from "../lib/lifelog/ingestion.ts";

function createSupabaseTableRecorder() {
  const calls: Array<{
    table: string;
    rows: unknown[];
    options: unknown;
  }> = [];

  return {
    calls,
    client: {
      from(table: string) {
        return {
          upsert(rows: unknown | unknown[], options?: unknown) {
            const normalizedRows = Array.isArray(rows) ? rows : [rows];
            calls.push({
              table,
              rows: normalizedRows,
              options,
            });

            const result =
              table === "conversations"
                ? { data: { id: "local-conversation-1", fieldy_id: "conversation-1" }, error: null }
                : { data: normalizedRows, error: null };

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
});
