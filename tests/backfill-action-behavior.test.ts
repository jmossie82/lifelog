import assert from "node:assert/strict";
import { test } from "node:test";

import { runFieldyBackfill } from "../app/actions/backfill-fieldy-core.ts";

const ownerUserId = "00000000-0000-4000-8000-000000000001";
const boundedConversation = {
  id: "conversation-1",
  startTime: "2026-06-15T10:00:00.000Z",
  endTime: "2026-06-15T10:30:00.000Z",
};

function createSyncRunStore({
  updateErrors = [],
}: {
  updateErrors?: unknown[];
} = {}) {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const errors = [...updateErrors];

  const supabase = {
    from(table: string) {
      assert.equal(table, "sync_runs");

      return {
        insert(values: unknown) {
          inserts.push(values);

          return {
            select() {
              return {
                async single() {
                  return {
                    data: { id: "sync-run-1" },
                    error: null,
                  };
                },
              };
            },
          };
        },
        update(values: unknown) {
          updates.push(values);

          return {
            async eq(column: string, value: string) {
              assert.equal(column, "id");
              assert.equal(value, "sync-run-1");
              return {
                error: errors.shift() ?? null,
              };
            },
          };
        },
      };
    },
  };

  return { inserts, supabase, updates };
}

function createHarness({
  user = { id: ownerUserId },
  conversations = [boundedConversation],
  tasks = [],
  ingestResults = [{ conversationCount: 1, transcriptionCount: 0, taskCount: 0 }],
  ingestErrors = [],
  syncRunStore = createSyncRunStore(),
}: {
  user?: { id: string } | null;
  conversations?: Array<{
    id: string;
    startTime?: string | null;
    endTime?: string | null;
  }>;
  tasks?: Array<{ title: string; status: "new"; memoryId?: string | null }>;
  ingestResults?: Array<{
    conversationCount: number;
    transcriptionCount: number;
    taskCount: number;
  }>;
  ingestErrors?: unknown[];
  syncRunStore?: ReturnType<typeof createSyncRunStore>;
} = {}) {
  const fieldyClients: unknown[] = [];
  const adminClients: unknown[] = [];
  const fetchedTranscriptionRanges: unknown[] = [];
  const ingestCalls: unknown[] = [];
  const revalidatedPaths: string[] = [];
  const results = [...ingestResults];
  const errors = [...ingestErrors];

  async function run() {
    return runFieldyBackfill({
      getOwnerUserId: () => ownerUserId,
      getCurrentUser: async () => user,
      getFieldyEnv: () => ({
        fieldyApiKey: "fieldy-key",
        fieldyBackfillDays: 2,
      }),
      createSupabaseAdminClient: () => {
        adminClients.push(syncRunStore.supabase);
        return syncRunStore.supabase;
      },
      createFieldyClient: (options) => {
        fieldyClients.push(options);

        return {
          async fetchConversations() {
            return conversations;
          },
          async fetchTasks() {
            return tasks;
          },
          async fetchTranscriptions(range) {
            fetchedTranscriptionRanges.push(range);
            return [{ text: "bounded transcript" }];
          },
        };
      },
      createIngestionService: () => ({
        async ingestConversationSet(input) {
          ingestCalls.push(input);
          const error = errors.shift();
          if (error) {
            throw error;
          }
          return results.shift() ?? {
            conversationCount: 1,
            transcriptionCount: 0,
            taskCount: 0,
          };
        },
      }),
      revalidatePath: (path) => {
        revalidatedPaths.push(path);
      },
      now: () => new Date("2026-06-16T00:00:00.000Z"),
    });
  }

  return {
    adminClients,
    fetchedTranscriptionRanges,
    fieldyClients,
    ingestCalls,
    revalidatedPaths,
    run,
    syncRunStore,
  };
}

test("signed-out and non-owner users are unauthorized without side effects", async () => {
  for (const user of [null, { id: "not-the-owner" }]) {
    const harness = createHarness({ user });

    assert.deepEqual(await harness.run(), {
      ok: false,
      error: "Unauthorized",
    });
    assert.equal(harness.adminClients.length, 0);
    assert.equal(harness.fieldyClients.length, 0);
    assert.deepEqual(harness.revalidatedPaths, []);
  }
});

test("unbounded conversations fail before transcription fetch", async () => {
  const harness = createHarness({
    conversations: [{ id: "conversation-1", startTime: null, endTime: null }],
  });

  assert.deepEqual(await harness.run(), {
    ok: false,
    error: "Fieldy backfill failed",
  });
  assert.equal(harness.fetchedTranscriptionRanges.length, 0);
  assert.deepEqual(harness.syncRunStore.updates.at(-1), {
    status: "failed",
    imported_count: 0,
    error_message: "Fieldy backfill encountered an unbounded conversation",
    finished_at: "2026-06-16T00:00:00.000Z",
  });
});

test("failed backfills record partial all-row imported count", async () => {
  const harness = createHarness({
    conversations: [
      boundedConversation,
      {
        id: "conversation-2",
        startTime: "2026-06-15T11:00:00.000Z",
        endTime: "2026-06-15T11:30:00.000Z",
      },
    ],
    ingestResults: [{ conversationCount: 1, transcriptionCount: 2, taskCount: 3 }],
    ingestErrors: [null, new Error("raw transcript failure")],
  });

  assert.deepEqual(await harness.run(), {
    ok: false,
    error: "Fieldy backfill failed",
  });
  assert.deepEqual(harness.syncRunStore.updates.at(-1), {
    status: "failed",
    imported_count: 6,
    error_message: "Fieldy backfill failed",
    finished_at: "2026-06-16T00:00:00.000Z",
  });
});

test("success finalization failure preserves imported count in failure update", async () => {
  const syncRunStore = createSyncRunStore({
    updateErrors: [new Error("success update failed")],
  });
  const harness = createHarness({
    ingestResults: [{ conversationCount: 1, transcriptionCount: 2, taskCount: 3 }],
    syncRunStore,
  });

  assert.deepEqual(await harness.run(), {
    ok: false,
    error: "Fieldy backfill failed",
  });
  assert.deepEqual(syncRunStore.updates, [
    {
      status: "succeeded",
      imported_count: 6,
      error_message: null,
      finished_at: "2026-06-16T00:00:00.000Z",
    },
    {
      status: "failed",
      imported_count: 6,
      error_message: "Fieldy backfill failed",
      finished_at: "2026-06-16T00:00:00.000Z",
    },
  ]);
});

test("tasks passed to ingestion are scoped to the conversation memory id", async () => {
  const harness = createHarness({
    tasks: [
      { title: "Include", status: "new", memoryId: "conversation-1" },
      { title: "Exclude", status: "new", memoryId: "conversation-2" },
      { title: "Also exclude", status: "new", memoryId: null },
    ],
  });

  assert.deepEqual(await harness.run(), { ok: true, importedCount: 1 });
  assert.deepEqual(harness.ingestCalls, [
    {
      conversation: boundedConversation,
      transcriptions: [{ text: "bounded transcript" }],
      tasks: [{ title: "Include", status: "new", memoryId: "conversation-1" }],
    },
  ]);
});

test("dashboard is revalidated on success and recorded failure", async () => {
  const success = createHarness();
  const failure = createHarness({
    conversations: [{ id: "conversation-1", startTime: null, endTime: null }],
  });

  await success.run();
  await failure.run();

  assert.deepEqual(success.revalidatedPaths, ["/"]);
  assert.deepEqual(failure.revalidatedPaths, ["/"]);
});
