import assert from "node:assert/strict";
import { test } from "node:test";

import {
  embedMissingConversations,
  type ConversationEmbeddingRow,
  type ConversationEmbeddingSupabase,
  type QueryResult,
  type SelectQuery,
  type TranscriptionEmbeddingRow,
  type UpdateQuery,
} from "../lib/lifelog/conversation-embeddings.ts";

test("embedMissingConversations embeds stale owner conversations and updates hash metadata", async () => {
  const updates: unknown[] = [];
  const embeddedInputs: string[] = [];
  const client = createEmbeddingRecordingClient({
    conversations: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        user_id: "owner-1",
        fieldy_id: "fieldy-1",
        title: "Budget",
        summary: "Planning",
        content: "Budget planning notes",
        keywords: ["budget"],
        embedding_input_hash: "old",
      },
      {
        id: "00000000-0000-4000-8000-000000000099",
        user_id: "owner-2",
        fieldy_id: "fieldy-2",
        title: "Other owner",
        summary: "Private other owner data",
        content: "This must not be embedded",
        keywords: ["private"],
        embedding_input_hash: "old",
      },
    ],
    transcriptions: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        user_id: "owner-1",
        conversation_id: "00000000-0000-4000-8000-000000000001",
        speaker_label: "Jamie",
        text: "Need the proposal",
        started_at: "2026-06-17T15:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000011",
        user_id: "owner-2",
        conversation_id: "00000000-0000-4000-8000-000000000001",
        speaker_label: "Other",
        text: "Other owner transcript must not be included",
        started_at: "2026-06-17T15:01:00.000Z",
      },
    ],
    updates,
  });

  const result = await embedMissingConversations({
    supabase: client,
    ownerUserId: "owner-1",
    embeddingModel: "text-embedding-3-small",
    embedText: async (input) => {
      embeddedInputs.push(input);
      return [0.1, 0.2, 0.3];
    },
    now: new Date("2026-06-17T16:00:00.000Z"),
  });

  assert.equal(result.embeddedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(embeddedInputs.length, 1);
  assert.match(embeddedInputs[0], /Title: Budget/);
  assert.match(embeddedInputs[0], /Speaker 1: Need the proposal/);
  assert.doesNotMatch(embeddedInputs[0], /Other owner/);
  assert.doesNotMatch(embeddedInputs[0], /Other owner transcript/);
  assert.equal((updates[0] as { embedding: string }).embedding, "[0.1,0.2,0.3]");
  assert.equal(
    (updates[0] as { embedding_model: string }).embedding_model,
    "text-embedding-3-small",
  );
  assert.match(
    (updates[0] as { embedding_input_hash: string }).embedding_input_hash,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    (updates[0] as { embedded_at: string }).embedded_at,
    "2026-06-17T16:00:00.000Z",
  );
  assert.equal((updates[0] as { embedding_error: null }).embedding_error, null);
  assert.deepEqual(client.updateMatches, [
    {
      id: "00000000-0000-4000-8000-000000000001",
      user_id: "owner-1",
    },
  ]);
});

test("embedMissingConversations skips unchanged conversations", async () => {
  const updates: unknown[] = [];
  const client = createEmbeddingRecordingClient({
    conversations: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        user_id: "owner-1",
        fieldy_id: "fieldy-1",
        title: "Budget",
        summary: "Planning",
        content: "Budget planning notes",
        keywords: ["budget"],
        embedding_input_hash: "old",
      },
    ],
    transcriptions: [],
    updates,
  });

  const first = await embedMissingConversations({
    supabase: client,
    ownerUserId: "owner-1",
    embeddingModel: "text-embedding-3-small",
    embedText: async () => [0.1, 0.2, 0.3],
    now: new Date("2026-06-17T16:00:00.000Z"),
  });

  const generatedHash = (updates[0] as { embedding_input_hash: string }).embedding_input_hash;
  updates.length = 0;
  client.setConversationHash(generatedHash);

  const second = await embedMissingConversations({
    supabase: client,
    ownerUserId: "owner-1",
    embeddingModel: "text-embedding-3-small",
    embedText: async () => {
      throw new Error("should not embed unchanged input");
    },
    now: new Date("2026-06-17T16:01:00.000Z"),
  });

  assert.equal(first.embeddedCount, 1);
  assert.equal(second.embeddedCount, 0);
  assert.equal(second.skippedCount, 1);
  assert.equal(updates.length, 0);
});

test("embedMissingConversations fetches owner transcriptions in one batched query", async () => {
  const updates: unknown[] = [];
  const client = createEmbeddingRecordingClient({
    conversations: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        user_id: "owner-1",
        fieldy_id: "fieldy-1",
        title: "Budget",
        summary: "",
        content: null,
        keywords: [],
        embedding_input_hash: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        user_id: "owner-1",
        fieldy_id: "fieldy-2",
        title: "Roadmap",
        summary: "",
        content: null,
        keywords: [],
        embedding_input_hash: null,
      },
    ],
    transcriptions: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        user_id: "owner-1",
        conversation_id: "00000000-0000-4000-8000-000000000001",
        speaker_label: "Jamie",
        text: "First transcript",
        started_at: "2026-06-17T15:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000011",
        user_id: "owner-1",
        conversation_id: "00000000-0000-4000-8000-000000000002",
        speaker_label: "Alex",
        text: "Second transcript",
        started_at: "2026-06-17T15:01:00.000Z",
      },
    ],
    updates,
  });

  const embeddedInputs: string[] = [];
  const result = await embedMissingConversations({
    supabase: client,
    ownerUserId: "owner-1",
    embeddingModel: "text-embedding-3-small",
    embedText: async (input) => {
      embeddedInputs.push(input);
      return [0.1, 0.2, 0.3];
    },
  });

  assert.equal(result.embeddedCount, 2);
  assert.equal(client.queryCounts.transcriptions, 1);
  assert.match(embeddedInputs[0], /First transcript/);
  assert.match(embeddedInputs[1], /Second transcript/);
});

test("embedMissingConversations skips empty conversations without embedding", async () => {
  const updates: unknown[] = [];
  const client = createEmbeddingRecordingClient({
    conversations: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        user_id: "owner-1",
        fieldy_id: "fieldy-1",
        title: "",
        summary: "",
        content: null,
        keywords: ["  "],
        embedding_input_hash: null,
      },
    ],
    transcriptions: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        user_id: "owner-1",
        conversation_id: "00000000-0000-4000-8000-000000000001",
        speaker_label: "Jamie",
        text: "   ",
        started_at: "2026-06-17T15:00:00.000Z",
      },
    ],
    updates,
  });

  const result = await embedMissingConversations({
    supabase: client,
    ownerUserId: "owner-1",
    embeddingModel: "text-embedding-3-small",
    embedText: async () => {
      throw new Error("should not embed empty input");
    },
    now: new Date("2026-06-17T16:00:00.000Z"),
  });

  assert.equal(result.embeddedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(updates.length, 0);
});

test("embedMissingConversations propagates fetch and update errors", async () => {
  const fetchError = new Error("conversation fetch failed");
  const fetchClient = createEmbeddingRecordingClient({
    conversations: [],
    transcriptions: [],
    updates: [],
    conversationError: fetchError,
  });

  await assert.rejects(
    () =>
      embedMissingConversations({
        supabase: fetchClient,
        ownerUserId: "owner-1",
        embeddingModel: "text-embedding-3-small",
        embedText: async () => [0.1],
      }),
    fetchError,
  );

  const updateError = new Error("update failed");
  const updateClient = createEmbeddingRecordingClient({
    conversations: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        user_id: "owner-1",
        fieldy_id: "fieldy-1",
        title: "Budget",
        summary: "",
        content: null,
        keywords: [],
        embedding_input_hash: null,
      },
    ],
    transcriptions: [],
    updates: [],
    updateError,
  });

  await assert.rejects(
    () =>
      embedMissingConversations({
        supabase: updateClient,
        ownerUserId: "owner-1",
        embeddingModel: "text-embedding-3-small",
        embedText: async () => [0.1],
      }),
    updateError,
  );
});

function createEmbeddingRecordingClient({
  conversations,
  transcriptions,
  updates,
  conversationError = null,
  transcriptionError = null,
  updateError = null,
}: {
  conversations: ConversationEmbeddingRow[];
  transcriptions: TranscriptionEmbeddingRow[];
  updates: unknown[];
  conversationError?: Error | null;
  transcriptionError?: Error | null;
  updateError?: Error | null;
}): ConversationEmbeddingSupabase & {
  setConversationHash(hash: string): void;
  queryCounts: { transcriptions: number };
  updateMatches: unknown[];
} {
  const updateMatches: unknown[] = [];
  const queryCounts = { transcriptions: 0 };
  const from = createFrom({
    conversations,
    transcriptions,
    updates,
    updateMatches,
    queryCounts,
    conversationError,
    transcriptionError,
    updateError,
  });

  return {
    queryCounts,
    updateMatches,
    setConversationHash(hash: string) {
      conversations[0].embedding_input_hash = hash;
    },
    from,
  } as unknown as ConversationEmbeddingSupabase & {
    setConversationHash(hash: string): void;
    queryCounts: { transcriptions: number };
    updateMatches: unknown[];
  };
}

function createFrom({
  conversations,
  transcriptions,
  updates,
  updateMatches,
  queryCounts,
  conversationError,
  transcriptionError,
  updateError,
}: {
  conversations: ConversationEmbeddingRow[];
  transcriptions: TranscriptionEmbeddingRow[];
  updates: unknown[];
  updateMatches: unknown[];
  queryCounts: { transcriptions: number };
  conversationError: Error | null;
  transcriptionError: Error | null;
  updateError: Error | null;
}) {
  function from(table: "conversations"): SelectQuery<ConversationEmbeddingRow> & UpdateQuery;
  function from(table: "transcriptions"): SelectQuery<TranscriptionEmbeddingRow>;
  function from(
    table: "conversations" | "transcriptions",
  ):
    | (SelectQuery<ConversationEmbeddingRow> & UpdateQuery)
    | SelectQuery<TranscriptionEmbeddingRow> {
    if (table === "conversations") {
      return {
        ...createSelectQuery(conversations, conversationError),
        update(value: {
          embedding: string;
          embedding_model: string;
          embedding_input_hash: string;
          embedded_at: string;
          embedding_error: null;
        }) {
          updates.push(value);
          return {
            match(value: { id: string; user_id: string }) {
              updateMatches.push(value);
              return Promise.resolve({ error: updateError });
            },
          };
        },
      };
    }

    queryCounts.transcriptions += 1;
    return createSelectQuery(transcriptions, transcriptionError);
  }

  return from;
}

function createSelectQuery<TRow extends object>(
  rows: TRow[],
  error: Error | null,
): SelectQuery<TRow> {
  const filters: Record<string, unknown> = {};
  const builder: SelectQuery<TRow> = {
    select() {
      return builder;
    },
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    in(column: string, values: unknown[]) {
      filters[column] = values;
      return builder;
    },
    order(): Promise<QueryResult<TRow>> {
      return Promise.resolve({
        data: rows.filter((row) => matchesFilters(row, filters)),
        error,
      });
    },
  };

  return builder;
}

function matchesFilters<TRow extends object>(
  row: TRow,
  filters: Record<string, unknown>,
) {
  const values = row as Record<string, unknown>;
  return Object.entries(filters).every(([key, value]) => {
    if (Array.isArray(value)) {
      return value.includes(values[key]);
    }

    return values[key] === value;
  });
}
