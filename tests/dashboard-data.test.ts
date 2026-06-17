import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getDashboardData,
  mapDashboardData,
  mapSyncRunDisplay,
} from "../lib/lifelog/dashboard-data.ts";

test("mapDashboardData groups conversations and counts open tasks", () => {
  const data = mapDashboardData({
    conversations: [
      {
        id: "conversation-1",
        fieldy_id: "fieldy-conversation-1",
        title: "Standup",
        summary: "Daily planning.",
        started_at: "2026-06-16T15:00:00.000Z",
        ended_at: "2026-06-16T15:30:00.000Z",
        keywords: ["planning"],
        fieldy_metadata: { type: "conversation" },
      },
    ],
    tasks: [
      {
        id: "task-1",
        title: "Send notes",
        status: "new",
        due_at: "2026-06-17T15:00:00.000Z",
        conversation_id: "conversation-1",
      },
    ],
    syncRuns: [
      {
        id: "sync-1",
        source: "backfill",
        status: "succeeded",
        started_at: "2026-06-16T16:00:00.000Z",
        finished_at: "2026-06-16T16:01:00.000Z",
        imported_count: 1,
        error_message: null,
      },
    ],
  });

  assert.equal(data.conversations[0]?.title, "Standup");
  assert.equal(data.openTaskCount, 1);
  assert.equal(data.lastSync?.status, "succeeded");
});

test("mapDashboardData handles empty imported state", () => {
  const data = mapDashboardData({
    conversations: [],
    tasks: [],
    syncRuns: [],
  });

  assert.equal(data.conversations.length, 0);
  assert.equal(data.openTaskCount, 0);
  assert.equal(data.lastSync, null);
});

test("mapDashboardData exposes safe sync display fields", () => {
  const data = mapDashboardData({
    conversations: [],
    tasks: [],
    syncRuns: [
      {
        id: "sync-1",
        source: "backfill",
        status: "failed",
        started_at: "2026-06-16T16:00:00.000Z",
        finished_at: "2026-06-16T16:01:00.000Z",
        imported_count: 0,
        error_message:
          "sk-fieldy-secret owner 00000000-0000-4000-8000-000000000001 transcript Alice said call Fieldy conversation fld_1234567890",
      },
    ],
  });

  assert.deepEqual(data.lastSyncDisplay, {
    source: "backfill",
    status: "failed",
    importedCount: 0,
    finishedAt: "2026-06-16T16:01:00.000Z",
    displayError: "Sync failed. Check Fieldy configuration and try again.",
  });
});

test("mapSyncRunDisplay allowlists safe sync errors and redacts unsafe display text", () => {
  const cases = [
    ["Fieldy backfill failed", "Fieldy backfill failed"],
    ["Fieldy API request failed with 429", "Fieldy API request failed with 429"],
    ["sk-fieldy-secret", "Sync failed. Check Fieldy configuration and try again."],
    [
      "00000000-0000-4000-8000-000000000001",
      "Sync failed. Check Fieldy configuration and try again.",
    ],
    ["fld_1234567890", "Sync failed. Check Fieldy configuration and try again."],
    [
      "Alice said call me back after the appointment transcript text",
      "Sync failed. Check Fieldy configuration and try again.",
    ],
  ];

  for (const [errorMessage, expected] of cases) {
    assert.equal(
      mapSyncRunDisplay({
        id: "sync-1",
        source: "backfill",
        status: "failed",
        started_at: "2026-06-16T16:00:00.000Z",
        finished_at: "2026-06-16T16:01:00.000Z",
        imported_count: 0,
        error_message: errorMessage,
      })?.displayError,
      expected,
    );
  }
});

test("mapDashboardData counts only explicit open task statuses", () => {
  const data = mapDashboardData({
    conversations: [],
    tasks: [
      {
        id: "new-task",
        title: "New task",
        status: "new",
        due_at: null,
        conversation_id: null,
      },
      {
        id: "approved-task",
        title: "Approved task",
        status: "approved",
        due_at: null,
        conversation_id: null,
      },
      {
        id: "completed-task",
        title: "Completed task",
        status: "completed",
        due_at: null,
        conversation_id: null,
      },
      {
        id: "rejected-task",
        title: "Rejected task",
        status: "rejected",
        due_at: null,
        conversation_id: null,
      },
      {
        id: "skipped-task",
        title: "Skipped task",
        status: "skipped",
        due_at: null,
        conversation_id: null,
      },
      {
        id: "cancelled-task",
        title: "Cancelled task",
        status: "cancelled",
        due_at: null,
        conversation_id: null,
      },
      {
        id: "expired-task",
        title: "Expired task",
        status: "expired",
        due_at: null,
        conversation_id: null,
      },
    ],
    syncRuns: [],
  });

  assert.equal(data.openTaskCount, 2);
});

test("mapDashboardData maps persisted Fieldy conversation types", () => {
  const data = mapDashboardData({
    conversations: [
      {
        id: "conversation-1",
        fieldy_id: "fieldy-conversation-1",
        title: "Conversation",
        summary: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: { type: "conversation" },
      },
      {
        id: "note-1",
        fieldy_id: "fieldy-note-1",
        title: "Note",
        summary: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: { type: "note" },
      },
      {
        id: "task-1",
        fieldy_id: "fieldy-task-1",
        title: "Task",
        summary: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: { type: "task" },
      },
      {
        id: "mention-1",
        fieldy_id: "fieldy-mention-1",
        title: "Mention",
        summary: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: { type: "mention" },
      },
    ],
    tasks: [],
    syncRuns: [],
  });

  assert.deepEqual(
    data.conversations.map((conversation) => conversation.type),
    ["conversation", "note", "task", "mention"],
  );
});

test("mapDashboardData defaults unsafe or unknown Fieldy types to conversation", () => {
  const data = mapDashboardData({
    conversations: [
      {
        id: "null-metadata",
        fieldy_id: "fieldy-null-metadata",
        title: null,
        summary: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: null,
      },
      {
        id: "unknown-type",
        fieldy_id: "fieldy-unknown-type",
        title: null,
        summary: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: { type: "meeting" },
      },
      {
        id: "non-string-type",
        fieldy_id: "fieldy-non-string-type",
        title: null,
        summary: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: { type: 42 },
      },
      {
        id: "array-metadata",
        fieldy_id: "fieldy-array-metadata",
        title: null,
        summary: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: ["mention"],
      },
    ],
    tasks: [],
    syncRuns: [],
  });

  assert.deepEqual(
    data.conversations.map((conversation) => conversation.type),
    ["conversation", "conversation", "conversation", "conversation"],
  );
});

test("getDashboardData uses exact open task count beyond limited task rows", async () => {
  const calls: Array<{
    table: string;
    method: string;
    args: unknown[];
  }> = [];

  const responses = {
    conversations: {
      data: [],
      error: null,
    },
    tasks: {
      data: [
        {
          id: "completed-visible-task",
          title: "Already done",
          status: "completed",
          due_at: null,
          conversation_id: null,
        },
      ],
      error: null,
    },
    openTaskCount: {
      data: null,
      count: 42,
      error: null,
    },
    sync_runs: {
      data: [],
      error: null,
    },
  };

  const client = createRecordingDashboardClient({ calls, responses });

  const data = await getDashboardData(client as never, {
    userId: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(data.tasks.length, 1);
  assert.equal(data.openTaskCount, 42);
  assert.deepEqual(
    calls.filter((call) => call.table === "tasks" && call.method === "in").map((call) => call.args),
    [["status", ["new", "approved"]]],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.table === "tasks" && call.method === "select")
      .map((call) => call.args),
    [
      ["id, title, status, due_at, conversation_id"],
      ["id", { count: "exact", head: true }],
    ],
  );
});

test("getDashboardData rejects blank user id before creating queries", async () => {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      throw new Error("query should not be created");
    },
  };

  await assert.rejects(
    getDashboardData(client as never, { userId: " \n\t " }),
    /authenticated user id/,
  );
  assert.deepEqual(calls, []);
});

function createRecordingDashboardClient({
  calls,
  responses,
}: {
  calls: Array<{ table: string; method: string; args: unknown[] }>;
  responses: Record<string, { data: unknown; count?: number | null; error: unknown }>;
}) {
  return {
    from(table: string) {
      const operations: Array<{ method: string; args: unknown[] }> = [];
      const builder = {
        select(...args: unknown[]) {
          operations.push({ method: "select", args });
          calls.push({ table, method: "select", args });
          return builder;
        },
        eq(...args: unknown[]) {
          operations.push({ method: "eq", args });
          calls.push({ table, method: "eq", args });
          return builder;
        },
        or(...args: unknown[]) {
          operations.push({ method: "or", args });
          calls.push({ table, method: "or", args });
          return builder;
        },
        filter(...args: unknown[]) {
          operations.push({ method: "filter", args });
          calls.push({ table, method: "filter", args });
          return builder;
        },
        gte(...args: unknown[]) {
          operations.push({ method: "gte", args });
          calls.push({ table, method: "gte", args });
          return builder;
        },
        lt(...args: unknown[]) {
          operations.push({ method: "lt", args });
          calls.push({ table, method: "lt", args });
          return builder;
        },
        order(...args: unknown[]) {
          operations.push({ method: "order", args });
          calls.push({ table, method: "order", args });
          return builder;
        },
        range(...args: unknown[]) {
          operations.push({ method: "range", args });
          calls.push({ table, method: "range", args });
          return builder;
        },
        limit(...args: unknown[]) {
          operations.push({ method: "limit", args });
          calls.push({ table, method: "limit", args });
          return builder;
        },
        in(...args: unknown[]) {
          operations.push({ method: "in", args });
          calls.push({ table, method: "in", args });
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const isTaskCount = table === "tasks" && operations.some(
            (operation) =>
              operation.method === "select" &&
              (operation.args[1] as { head?: boolean } | undefined)?.head === true,
          );
          const key = isTaskCount ? "openTaskCount" : table;
          return Promise.resolve(responses[key]).then(resolve, reject);
        },
      };

      return builder;
    },
  };
}

test("getDashboardData applies search type range ordering and cumulative range before returning pagination metadata", async () => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const responses = {
    conversations: { data: [], count: 48, error: null },
    tasks: { data: [], error: null },
    openTaskCount: { data: null, count: 0, error: null },
    sync_runs: { data: [], error: null },
  };

  const client = createRecordingDashboardClient({ calls, responses });

  const data = await getDashboardData(client as never, {
    userId: "00000000-0000-4000-8000-000000000001",
    query: { q: "budget", type: "note", range: "today", page: 2 },
    displayTimeZone: "America/Chicago",
    now: new Date("2026-06-17T15:30:00.000Z"),
  });

  assert.equal(data.totalConversationCount, 48);
  assert.equal(data.shownConversationCount, 0);
  assert.equal(data.hasMoreConversations, true);
  assert.deepEqual(
    calls
      .filter((call) => call.table === "conversations")
      .map((call) => [call.method, call.args]),
    [
      [
        "select",
        [
          "id, fieldy_id, title, summary, started_at, ended_at, keywords, fieldy_metadata",
          { count: "exact" },
        ],
      ],
      ["eq", ["user_id", "00000000-0000-4000-8000-000000000001"]],
      ["or", ["title.ilike.*budget*,summary.ilike.*budget*,content.ilike.*budget*"]],
      ["filter", ["fieldy_metadata->>type", "eq", "note"]],
      ["gte", ["started_at", "2026-06-17T05:00:00.000Z"]],
      ["lt", ["started_at", "2026-06-18T05:00:00.000Z"]],
      ["order", ["started_at", { ascending: false, nullsFirst: false }]],
      ["order", ["id", { ascending: false }]],
      ["range", [0, 49]],
    ],
  );
});

test("getDashboardData applies conversation fallback type filter before pagination", async () => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const responses = {
    conversations: { data: [], count: 0, error: null },
    tasks: { data: [], error: null },
    openTaskCount: { data: null, count: 0, error: null },
    sync_runs: { data: [], error: null },
  };

  const client = createRecordingDashboardClient({ calls, responses });

  await getDashboardData(client as never, {
    userId: "00000000-0000-4000-8000-000000000001",
    query: { q: "", type: "conversation", range: "all", page: 1 },
    displayTimeZone: "America/Chicago",
    now: new Date("2026-06-17T15:30:00.000Z"),
  });

  assert.deepEqual(
    calls
      .filter((call) => call.table === "conversations" && call.method === "or")
      .map((call) => call.args),
    [
      [
        "fieldy_metadata->>type.is.null,fieldy_metadata->>type.eq.conversation,fieldy_metadata->>type.not.in.(note,task,mention)",
      ],
    ],
  );
});
