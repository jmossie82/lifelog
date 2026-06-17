import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getDashboardData,
  mapDashboardData,
  mapSyncRunDisplay,
} from "../lib/lifelog/dashboard-data.ts";

type RecordingCall = {
  table: string;
  method: string;
  args: unknown[];
  queryId?: number;
};

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
  assert.equal(data.importedConversationCount, 0);
  assert.equal(data.lastSync, null);
});

test("mapDashboardData does not expose raw sync errors to client data", () => {
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

  assert.deepEqual(data.lastSync, {
    id: "sync-1",
    source: "backfill",
    status: "failed",
    started_at: "2026-06-16T16:00:00.000Z",
    finished_at: "2026-06-16T16:01:00.000Z",
    imported_count: 0,
  });
  assert.equal("error_message" in (data.lastSync ?? {}), false);
  assert.equal(JSON.stringify(data).includes("sk-fieldy-secret"), false);
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

test("mapSyncRunDisplay truncates safe display errors", () => {
  const display = mapSyncRunDisplay({
    id: "sync-1",
    source: "backfill",
    status: "failed",
    started_at: "2026-06-16T16:00:00.000Z",
    finished_at: "2026-06-16T16:01:00.000Z",
    imported_count: 0,
    error_message: `Fieldy API request failed with ${"9".repeat(200)}`,
  });

  assert.equal(display?.displayError?.length, 160);
  assert.equal(display?.displayError?.endsWith("..."), true);
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

test("mapDashboardData stops pagination at the reachable page cap", () => {
  const data = mapDashboardData({
    conversations: [],
    tasks: [],
    syncRuns: [],
    query: { q: "", type: "all", range: "all", page: 20 },
    totalConversationCount: 501,
  });

  assert.equal(data.hasMoreConversations, false);
});

test("getDashboardData uses exact open task count beyond limited task rows", async () => {
  const calls: RecordingCall[] = [];

  const responses = {
    conversations: {
      data: [],
      error: null,
    },
    importedConversationCount: {
      data: null,
      count: 0,
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
  calls: RecordingCall[];
  responses: Record<string, { data: unknown; count?: number | null; error: unknown }>;
}) {
  let nextQueryId = 1;

  return {
    from(table: string) {
      const queryId = nextQueryId;
      nextQueryId += 1;
      const operations: Array<{ method: string; args: unknown[] }> = [];
      const builder = {
        select(...args: unknown[]) {
          operations.push({ method: "select", args });
          calls.push({ table, method: "select", args, queryId });
          return builder;
        },
        eq(...args: unknown[]) {
          operations.push({ method: "eq", args });
          calls.push({ table, method: "eq", args, queryId });
          return builder;
        },
        or(...args: unknown[]) {
          operations.push({ method: "or", args });
          calls.push({ table, method: "or", args, queryId });
          return builder;
        },
        filter(...args: unknown[]) {
          operations.push({ method: "filter", args });
          calls.push({ table, method: "filter", args, queryId });
          return builder;
        },
        gte(...args: unknown[]) {
          operations.push({ method: "gte", args });
          calls.push({ table, method: "gte", args, queryId });
          return builder;
        },
        lt(...args: unknown[]) {
          operations.push({ method: "lt", args });
          calls.push({ table, method: "lt", args, queryId });
          return builder;
        },
        order(...args: unknown[]) {
          operations.push({ method: "order", args });
          calls.push({ table, method: "order", args, queryId });
          return builder;
        },
        range(...args: unknown[]) {
          operations.push({ method: "range", args });
          calls.push({ table, method: "range", args, queryId });
          return builder;
        },
        limit(...args: unknown[]) {
          operations.push({ method: "limit", args });
          calls.push({ table, method: "limit", args, queryId });
          return builder;
        },
        in(...args: unknown[]) {
          operations.push({ method: "in", args });
          calls.push({ table, method: "in", args, queryId });
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const isTaskCount = table === "tasks" && operations.some(
            (operation) =>
              operation.method === "select" &&
              (operation.args[1] as { head?: boolean } | undefined)?.head === true,
          );
          const isImportedConversationCount = table === "conversations" && operations.some(
            (operation) =>
              operation.method === "select" &&
              (operation.args[1] as { head?: boolean } | undefined)?.head === true,
          );
          const key = isTaskCount
            ? "openTaskCount"
            : isImportedConversationCount
              ? "importedConversationCount"
              : table;
          return Promise.resolve(responses[key]).then(resolve, reject);
        },
      };

      return builder;
    },
  };
}

test("getDashboardData applies search type range ordering and cumulative range before returning pagination metadata", async () => {
  const calls: RecordingCall[] = [];
  const responses = {
    conversations: { data: [], count: 60, error: null },
    importedConversationCount: { data: null, count: 71, error: null },
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

  assert.equal(data.totalConversationCount, 60);
  assert.equal(data.importedConversationCount, 71);
  assert.equal(data.shownConversationCount, 0);
  assert.equal(data.hasMoreConversations, true);
  const filteredConversationsQueryId = calls.find(
    (call) => call.table === "conversations",
  )?.queryId;
  assert.ok(filteredConversationsQueryId);
  assert.deepEqual(
    calls
      .filter(
        (call) =>
          call.table === "conversations" &&
          call.queryId === filteredConversationsQueryId,
      )
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

test("getDashboardData fetches unfiltered imported conversation count for empty-state semantics", async () => {
  const calls: RecordingCall[] = [];
  const responses = {
    conversations: { data: [], count: 0, error: null },
    importedConversationCount: { data: null, count: 7, error: null },
    tasks: { data: [], error: null },
    openTaskCount: { data: null, count: 0, error: null },
    sync_runs: { data: [], error: null },
  };

  const client = createRecordingDashboardClient({ calls, responses });

  const data = await getDashboardData(client as never, {
    userId: "00000000-0000-4000-8000-000000000001",
    query: { q: "filtered away", type: "note", range: "today", page: 1 },
    displayTimeZone: "America/Chicago",
    now: new Date("2026-06-17T15:30:00.000Z"),
  });

  assert.equal(data.totalConversationCount, 0);
  assert.equal(data.importedConversationCount, 7);

  const countQueryId = calls.find(
    (call) =>
      call.table === "conversations" &&
      call.method === "select" &&
      (call.args[1] as { head?: boolean } | undefined)?.head === true,
  )?.queryId;
  assert.ok(countQueryId);
  assert.deepEqual(
    calls
      .filter((call) => call.table === "conversations" && call.queryId === countQueryId)
      .map((call) => [call.method, call.args]),
    [
      ["select", ["id", { count: "exact", head: true }]],
      ["eq", ["user_id", "00000000-0000-4000-8000-000000000001"]],
    ],
  );
});

test("getDashboardData applies conversation fallback type filter before pagination", async () => {
  const calls: RecordingCall[] = [];
  const responses = {
    conversations: { data: [], count: 0, error: null },
    importedConversationCount: { data: null, count: 0, error: null },
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

test("getDashboardData ANDs search with the conversation fallback type group", async () => {
  const calls: RecordingCall[] = [];
  const responses = {
    conversations: { data: [], count: 0, error: null },
    importedConversationCount: { data: null, count: 0, error: null },
    tasks: { data: [], error: null },
    openTaskCount: { data: null, count: 0, error: null },
    sync_runs: { data: [], error: null },
  };

  const client = createRecordingDashboardClient({ calls, responses });

  await getDashboardData(client as never, {
    userId: "00000000-0000-4000-8000-000000000001",
    query: { q: "budget", type: "conversation", range: "all", page: 1 },
    displayTimeZone: "America/Chicago",
    now: new Date("2026-06-17T15:30:00.000Z"),
  });

  assert.deepEqual(
    calls
      .filter((call) => call.table === "conversations" && call.method === "or")
      .map((call) => call.args),
    [
      ["title.ilike.*budget*,summary.ilike.*budget*,content.ilike.*budget*"],
      [
        "fieldy_metadata->>type.is.null,fieldy_metadata->>type.eq.conversation,fieldy_metadata->>type.not.in.(note,task,mention)",
      ],
    ],
  );
});
