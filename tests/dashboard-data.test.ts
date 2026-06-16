import assert from "node:assert/strict";
import { test } from "node:test";

import { mapDashboardData } from "../lib/lifelog/dashboard-data.ts";

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
