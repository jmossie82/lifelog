import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getDashboardData,
  mapDashboardData,
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

  const client = {
    from(table: string) {
      calls.push({ table, method: "from", args: [] });
      const operations: Array<{ method: string; args: unknown[] }> = [];

      const builder = {
        select(...args: unknown[]) {
          operations.push({ method: "select", args });
          calls.push({ table, method: "select", args });
          return builder;
        },
        order(...args: unknown[]) {
          operations.push({ method: "order", args });
          calls.push({ table, method: "order", args });
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
          const isCountQuery = operations.some(
            (operation) =>
              operation.method === "select" &&
              (operation.args[1] as { count?: string; head?: boolean } | undefined)
                ?.count === "exact",
          );
          const response = isCountQuery
            ? responses.openTaskCount
            : responses[table as keyof typeof responses];

          return Promise.resolve(response).then(resolve, reject);
        },
      };

      return builder;
    },
  };

  const data = await getDashboardData(client as never);

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
