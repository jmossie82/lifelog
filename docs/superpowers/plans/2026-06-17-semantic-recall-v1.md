# Semantic Recall V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private semantic recall search over imported Fieldy conversations using OpenAI embeddings and Supabase pgvector, while preserving the current owner-only data boundary.

**Architecture:** Store one conversation-level embedding on `public.conversations` first, not a separate chunk table. A server-only embedding job fills missing or stale embeddings with idempotent hashes, and an authenticated server helper embeds a query then calls a Supabase RPC that returns only owner-visible conversation matches. Full answer synthesis and multi-turn chat stay deferred until retrieval quality is visible.

**Tech Stack:** Next.js App Router 16.2.9, TypeScript strict mode, Supabase Postgres + `extensions.vector(1536)`, Supabase RPC via `supabase-js`, OpenAI embeddings API with `text-embedding-3-small`, Node `node:test`, existing CSS/lucide-react UI.

---

## Context And Current Docs

Context7 checks performed before writing this plan:

- Supabase docs: pgvector setup uses `extensions.vector(1536)`, vector RPC functions, and `supabase.rpc(...)` from server code.
- OpenAI API docs: embeddings are generated through the embeddings API with `model: "text-embedding-3-small"` and plain text input.

Perplexity research reinforced these planning choices:

- Build semantic search before full RAG/chat so retrieval quality can be tuned separately from answer generation.
- Treat embeddings as sensitive private data.
- Store embedding model/version/hash metadata for idempotent re-embedding.
- Use RLS or explicit owner filters in vector RPCs because permissions are easy to accidentally bypass in retrieval systems.

## Product Scope

This phase adds:

- Conversation-level embeddings for imported conversations.
- A manual owner-only "embed missing conversations" action.
- A semantic recall search form and results page/section.
- Server-side query embedding and vector lookup.
- Tests for schema, embedding input privacy boundaries, idempotency, RPC call shape, and UI source contracts.

This phase does not add:

- LLM answer synthesis.
- Streaming chat.
- Multi-turn memory.
- Transcript chunk embeddings.
- Background cron jobs.
- A new UI framework.

## File Structure

- Create `supabase/migrations/20260617000000_semantic_recall_v1.sql`: vector extension, embedding columns, indexes, and `match_conversations`.
- Modify `lib/supabase/types.ts`: generated or manually updated types for new columns/RPC once migration is applied.
- Modify `lib/env.ts`: server-only OpenAI embedding env parsing.
- Create `lib/lifelog/embedding-input.ts`: deterministic conversation embedding input and SHA-256 hash helpers.
- Create `lib/lifelog/openai-embeddings.ts`: server-only OpenAI embeddings API wrapper using `fetch`.
- Create `lib/lifelog/conversation-embeddings.ts`: owner-scoped embedding backfill service.
- Create `lib/lifelog/semantic-recall.ts`: authenticated semantic recall query helper.
- Create `app/actions/embed-conversations.ts`: owner-only manual embedding Server Action.
- Create `lib/lifelog/embed-action-state.ts`: shared `useActionState` state type.
- Modify `components/lifelog-dashboard.tsx`: add recall search and embedding action UI using current layout.
- Modify `app/page.tsx`: load semantic query results from URL params and pass them to the dashboard.
- Modify `app/globals.css`: focused styles for recall results and embedding status.
- Add tests in `tests/`: schema, env, embedding input, OpenAI client, embedding service, semantic recall helper, page source, dashboard source.

## Task 1: Add Vector Schema And Match RPC

**Files:**
- Create: `supabase/migrations/20260617000000_semantic_recall_v1.sql`
- Modify: `tests/supabase-schema.test.ts`

- [ ] **Step 1: Add failing schema tests**

Append these tests to `tests/supabase-schema.test.ts`:

```ts
const semanticRecallMigration = readFileSync(
  "supabase/migrations/20260617000000_semantic_recall_v1.sql",
  "utf8",
);

const normalizedSemanticRecallMigration = semanticRecallMigration
  .replace(/\s+/g, " ")
  .trim();

test("semantic recall migration enables pgvector and conversation embeddings", () => {
  assert.match(
    normalizedSemanticRecallMigration,
    /create extension if not exists vector with schema extensions;/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /alter table public\.conversations add column embedding extensions\.vector\(1536\)/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /alter table public\.conversations add column embedding_model text/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /alter table public\.conversations add column embedding_input_hash text/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /alter table public\.conversations add column embedded_at timestamptz/,
  );
});

test("semantic recall match rpc keeps results owner scoped", () => {
  assert.match(
    normalizedSemanticRecallMigration,
    /create or replace function public\.match_conversations/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /query_embedding extensions\.vector\(1536\)/,
  );
  assert.match(normalizedSemanticRecallMigration, /match_count integer/);
  assert.match(normalizedSemanticRecallMigration, /match_threshold double precision/);
  assert.match(
    normalizedSemanticRecallMigration,
    /where conversations\.user_id = \(select auth\.uid\(\)\)/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /and public\.is_lifelog_owner\(conversations\.user_id\)/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /1 - \(conversations\.embedding <=> query_embedding\) as similarity/,
  );
  assert.match(
    normalizedSemanticRecallMigration,
    /grant execute on function public\.match_conversations/,
  );
  assert.doesNotMatch(
    normalizedSemanticRecallMigration,
    /grant execute on function public\.match_conversations[^;]+to public;/,
  );
});
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/supabase-schema.test.ts
```

Expected: FAIL because `20260617000000_semantic_recall_v1.sql` does not exist.

- [ ] **Step 3: Create semantic recall migration**

Create `supabase/migrations/20260617000000_semantic_recall_v1.sql`:

```sql
create extension if not exists vector with schema extensions;

alter table public.conversations
  add column embedding extensions.vector(1536),
  add column embedding_model text,
  add column embedding_input_hash text,
  add column embedded_at timestamptz,
  add column embedding_error text;

create index conversations_embedding_hnsw_idx
  on public.conversations
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create index conversations_user_embedding_hash_idx
  on public.conversations (user_id, embedding_input_hash)
  where embedding_input_hash is not null;

create or replace function public.match_conversations(
  query_embedding extensions.vector(1536),
  match_count integer default 10,
  match_threshold double precision default 0.7
)
returns table (
  id uuid,
  title text,
  summary text,
  started_at timestamptz,
  ended_at timestamptz,
  keywords text[],
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    conversations.id,
    conversations.title,
    conversations.summary,
    conversations.started_at,
    conversations.ended_at,
    conversations.keywords,
    1 - (conversations.embedding <=> query_embedding) as similarity
  from public.conversations
  where conversations.user_id = (select auth.uid())
    and public.is_lifelog_owner(conversations.user_id)
    and conversations.embedding is not null
    and 1 - (conversations.embedding <=> query_embedding) >= match_threshold
  order by conversations.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function public.match_conversations(
  extensions.vector(1536),
  integer,
  double precision
) from public;

grant execute on function public.match_conversations(
  extensions.vector(1536),
  integer,
  double precision
) to authenticated;
```

- [ ] **Step 4: Run schema tests**

Run:

```bash
node --test --experimental-strip-types tests/supabase-schema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add supabase/migrations/20260617000000_semantic_recall_v1.sql tests/supabase-schema.test.ts
git commit -m "Add semantic recall vector schema"
```

Expected: commit succeeds.

## Task 2: Add OpenAI Embedding Env And Input Hashing

**Files:**
- Modify: `lib/env.ts`
- Create: `lib/lifelog/embedding-input.ts`
- Modify: `tests/env.test.ts`
- Create: `tests/embedding-input.test.ts`

- [ ] **Step 1: Add failing env tests**

Append to `tests/env.test.ts`:

```ts
import { getOpenAiEmbeddingEnv } from "../lib/env.ts";

test("getOpenAiEmbeddingEnv returns server-only embedding settings", () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.LIFELOG_EMBEDDING_MODEL;

  process.env.OPENAI_API_KEY = "sk-test-openai";
  delete process.env.LIFELOG_EMBEDDING_MODEL;

  assert.deepEqual(getOpenAiEmbeddingEnv(), {
    openAiApiKey: "sk-test-openai",
    embeddingModel: "text-embedding-3-small",
  });

  process.env.LIFELOG_EMBEDDING_MODEL = "text-embedding-3-small";
  assert.equal(getOpenAiEmbeddingEnv().embeddingModel, "text-embedding-3-small");

  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;

  if (previousModel === undefined) delete process.env.LIFELOG_EMBEDDING_MODEL;
  else process.env.LIFELOG_EMBEDDING_MODEL = previousModel;
});
```

- [ ] **Step 2: Add failing embedding input tests**

Create `tests/embedding-input.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildConversationEmbeddingInput,
  hashConversationEmbeddingInput,
} from "../lib/lifelog/embedding-input.ts";

const conversation = {
  id: "00000000-0000-4000-8000-000000000001",
  fieldyId: "fieldy-conversation-1",
  title: "Budget meeting",
  summary: "We discussed next quarter planning.",
  content: "Full notes from the meeting.",
  keywords: ["budget", "planning"],
  transcript: [
    {
      speakerLabel: "Jamie",
      text: "We need to finish the proposal.",
      startedAt: "2026-06-17T15:00:00.000Z",
    },
    {
      speakerLabel: "Alex",
      text: "I will send the numbers.",
      startedAt: "2026-06-17T15:01:00.000Z",
    },
  ],
};

test("buildConversationEmbeddingInput creates deterministic bounded text", () => {
  assert.equal(
    buildConversationEmbeddingInput(conversation),
    [
      "Title: Budget meeting",
      "Summary: We discussed next quarter planning.",
      "Keywords: budget, planning",
      "Content: Full notes from the meeting.",
      "Transcript:",
      "Jamie: We need to finish the proposal.",
      "Alex: I will send the numbers.",
    ].join("\n"),
  );
});

test("buildConversationEmbeddingInput omits owner and Fieldy identifiers", () => {
  const input = buildConversationEmbeddingInput(conversation);

  assert.doesNotMatch(input, /00000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(input, /fieldy-conversation-1/);
});

test("hashConversationEmbeddingInput is stable for unchanged input", () => {
  const input = buildConversationEmbeddingInput(conversation);
  const first = hashConversationEmbeddingInput({
    input,
    embeddingModel: "text-embedding-3-small",
    inputVersion: 1,
  });
  const second = hashConversationEmbeddingInput({
    input,
    embeddingModel: "text-embedding-3-small",
    inputVersion: 1,
  });

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/env.test.ts tests/embedding-input.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 4: Implement env helper**

Append to `lib/env.ts`:

```ts
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export function getOpenAiEmbeddingEnv() {
  const embeddingModel =
    process.env.LIFELOG_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;

  if (embeddingModel !== DEFAULT_EMBEDDING_MODEL) {
    throw new Error(
      `LIFELOG_EMBEDDING_MODEL must be ${DEFAULT_EMBEDDING_MODEL}`,
    );
  }

  return {
    openAiApiKey: readRequiredEnv("OPENAI_API_KEY"),
    embeddingModel,
  };
}
```

- [ ] **Step 5: Implement embedding input helper**

Create `lib/lifelog/embedding-input.ts`:

```ts
import { createHash } from "node:crypto";

export const CONVERSATION_EMBEDDING_INPUT_VERSION = 1;
export const CONVERSATION_EMBEDDING_MAX_CHARS = 12_000;

export type ConversationEmbeddingInput = {
  id: string;
  fieldyId: string;
  title: string;
  summary: string;
  content: string | null;
  keywords: string[];
  transcript: Array<{
    speakerLabel: string | null;
    text: string;
    startedAt: string | null;
  }>;
};

function normalizeLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function pushLine(lines: string[], label: string, value: string | null | undefined) {
  const normalized = value ? normalizeLine(value) : "";
  if (normalized) {
    lines.push(`${label}: ${normalized}`);
  }
}

export function buildConversationEmbeddingInput(
  conversation: ConversationEmbeddingInput,
) {
  const lines: string[] = [];

  pushLine(lines, "Title", conversation.title);
  pushLine(lines, "Summary", conversation.summary);

  if (conversation.keywords.length > 0) {
    lines.push(`Keywords: ${conversation.keywords.map(normalizeLine).join(", ")}`);
  }

  pushLine(lines, "Content", conversation.content);

  if (conversation.transcript.length > 0) {
    lines.push("Transcript:");
    for (const segment of conversation.transcript) {
      const text = normalizeLine(segment.text);
      if (!text) continue;

      const speaker = segment.speakerLabel
        ? normalizeLine(segment.speakerLabel)
        : "Speaker";
      lines.push(`${speaker}: ${text}`);
    }
  }

  return lines.join("\n").slice(0, CONVERSATION_EMBEDDING_MAX_CHARS);
}

export function hashConversationEmbeddingInput({
  input,
  embeddingModel,
  inputVersion,
}: {
  input: string;
  embeddingModel: string;
  inputVersion: number;
}) {
  return createHash("sha256")
    .update(JSON.stringify({ input, embeddingModel, inputVersion }))
    .digest("hex");
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test --experimental-strip-types tests/env.test.ts tests/embedding-input.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/env.ts lib/lifelog/embedding-input.ts tests/env.test.ts tests/embedding-input.test.ts
git commit -m "Add embedding input helpers"
```

Expected: commit succeeds.

## Task 3: Add OpenAI Embeddings Client

**Files:**
- Create: `lib/lifelog/openai-embeddings.ts`
- Create: `tests/openai-embeddings.test.ts`

- [ ] **Step 1: Add failing OpenAI client tests**

Create `tests/openai-embeddings.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { createOpenAiEmbeddingClient } from "../lib/lifelog/openai-embeddings.ts";

test("createOpenAiEmbeddingClient posts sanitized embedding requests", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = createOpenAiEmbeddingClient({
    apiKey: "sk-test",
    embeddingModel: "text-embedding-3-small",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.deepEqual(await client.embedText("hello\nworld"), [0.1, 0.2, 0.3]);
  assert.equal(requests[0]?.url, "https://api.openai.com/v1/embeddings");
  assert.equal(requests[0]?.init.method, "POST");
  assert.equal(
    (requests[0]?.init.headers as Record<string, string>).Authorization,
    "Bearer sk-test",
  );
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    input: "hello world",
    model: "text-embedding-3-small",
  });
});

test("createOpenAiEmbeddingClient throws non-secret errors", async () => {
  const client = createOpenAiEmbeddingClient({
    apiKey: "sk-secret-value",
    embeddingModel: "text-embedding-3-small",
    fetch: async () =>
      new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    () => client.embedText("hello"),
    /OpenAI embedding request failed with 429/,
  );
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/openai-embeddings.test.ts
```

Expected: FAIL because `lib/lifelog/openai-embeddings.ts` does not exist.

- [ ] **Step 3: Implement OpenAI embeddings client**

Create `lib/lifelog/openai-embeddings.ts`:

```ts
type FetchLike = typeof fetch;

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

export function createOpenAiEmbeddingClient({
  apiKey,
  embeddingModel,
  fetch: fetchImpl = fetch,
}: {
  apiKey: string;
  embeddingModel: string;
  fetch?: FetchLike;
}) {
  async function embedText(input: string) {
    const normalizedInput = input.replace(/\s+/g, " ").trim();
    if (!normalizedInput) {
      throw new Error("Embedding input must not be empty");
    }

    const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: normalizedInput,
        model: embeddingModel,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding request failed with ${response.status}`);
    }

    const payload = (await response.json()) as EmbeddingResponse;
    const embedding = payload.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("OpenAI embedding response did not include an embedding");
    }

    return embedding;
  }

  return { embedText };
}
```

- [ ] **Step 4: Run OpenAI client tests**

Run:

```bash
node --test --experimental-strip-types tests/openai-embeddings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/lifelog/openai-embeddings.ts tests/openai-embeddings.test.ts
git commit -m "Add OpenAI embedding client"
```

Expected: commit succeeds.

## Task 4: Add Conversation Embedding Backfill Service

**Files:**
- Create: `lib/lifelog/conversation-embeddings.ts`
- Create: `tests/conversation-embeddings.test.ts`

- [ ] **Step 1: Add failing embedding service tests**

Create `tests/conversation-embeddings.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { embedMissingConversations } from "../lib/lifelog/conversation-embeddings.ts";

test("embedMissingConversations embeds stale owner conversations and updates hash metadata", async () => {
  const updates: unknown[] = [];
  const client = createEmbeddingRecordingClient({
    conversations: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        fieldy_id: "fieldy-1",
        title: "Budget",
        summary: "Planning",
        content: "Budget planning notes",
        keywords: ["budget"],
        embedding_input_hash: "old",
      },
    ],
    transcriptions: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        conversation_id: "00000000-0000-4000-8000-000000000001",
        speaker_label: "Jamie",
        text: "Need the proposal",
        started_at: "2026-06-17T15:00:00.000Z",
      },
    ],
    updates,
  });

  const result = await embedMissingConversations({
    supabase: client as never,
    ownerUserId: "owner-1",
    embeddingModel: "text-embedding-3-small",
    embedText: async () => [0.1, 0.2, 0.3],
    now: new Date("2026-06-17T16:00:00.000Z"),
  });

  assert.equal(result.embeddedCount, 1);
  assert.equal(result.skippedCount, 0);
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
});

test("embedMissingConversations skips unchanged conversations", async () => {
  const updates: unknown[] = [];
  const unchangedHash = "replace-after-first-run";
  const client = createEmbeddingRecordingClient({
    conversations: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        fieldy_id: "fieldy-1",
        title: "Budget",
        summary: "Planning",
        content: "Budget planning notes",
        keywords: ["budget"],
        embedding_input_hash: unchangedHash,
      },
    ],
    transcriptions: [],
    updates,
  });

  const first = await embedMissingConversations({
    supabase: client as never,
    ownerUserId: "owner-1",
    embeddingModel: "text-embedding-3-small",
    embedText: async () => [0.1, 0.2, 0.3],
    now: new Date("2026-06-17T16:00:00.000Z"),
  });

  const generatedHash = (updates[0] as { embedding_input_hash: string }).embedding_input_hash;
  updates.length = 0;
  client.setConversationHash(generatedHash);

  const second = await embedMissingConversations({
    supabase: client as never,
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
```

Add a small recording helper under the tests in the same file:

```ts
function createEmbeddingRecordingClient({
  conversations,
  transcriptions,
  updates,
}: {
  conversations: Array<Record<string, unknown>>;
  transcriptions: Array<Record<string, unknown>>;
  updates: unknown[];
}) {
  return {
    setConversationHash(hash: string) {
      conversations[0].embedding_input_hash = hash;
    },
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          if (table === "transcriptions" && column === "conversation_id") {
            return Promise.resolve({
              data: transcriptions.filter(
                (row) => row.conversation_id === value,
              ),
              error: null,
            });
          }
          return builder;
        },
        is() {
          return builder;
        },
        order() {
          return table === "conversations"
            ? Promise.resolve({ data: conversations, error: null })
            : builder;
        },
        update(value: unknown) {
          updates.push(value);
          return builder;
        },
        match() {
          return Promise.resolve({ data: [], error: null });
        },
      };

      return builder;
    },
  };
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/conversation-embeddings.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement embedding service**

Create `lib/lifelog/conversation-embeddings.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CONVERSATION_EMBEDDING_INPUT_VERSION,
  buildConversationEmbeddingInput,
  hashConversationEmbeddingInput,
} from "./embedding-input.ts";
import type { Database } from "@/lib/supabase/types";

type ConversationEmbeddingRow = Pick<
  Database["public"]["Tables"]["conversations"]["Row"],
  | "id"
  | "fieldy_id"
  | "title"
  | "summary"
  | "content"
  | "keywords"
  | "embedding_input_hash"
>;

type TranscriptionEmbeddingRow = Pick<
  Database["public"]["Tables"]["transcriptions"]["Row"],
  "id" | "conversation_id" | "speaker_label" | "text" | "started_at"
>;

export async function embedMissingConversations({
  supabase,
  ownerUserId,
  embeddingModel,
  embedText,
  now = new Date(),
}: {
  supabase: SupabaseClient<Database>;
  ownerUserId: string;
  embeddingModel: string;
  embedText: (input: string) => Promise<number[]>;
  now?: Date;
}) {
  const { data: conversations, error } = await supabase
    .from("conversations")
    .select(
      "id, fieldy_id, title, summary, content, keywords, embedding_input_hash",
    )
    .eq("user_id", ownerUserId)
    .order("started_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw error;
  }

  let embeddedCount = 0;
  let skippedCount = 0;

  for (const conversation of (conversations ?? []) as ConversationEmbeddingRow[]) {
    const { data: transcriptions, error: transcriptionsError } = await supabase
      .from("transcriptions")
      .select("id, conversation_id, speaker_label, text, started_at")
      .eq("conversation_id", conversation.id)
      .eq("user_id", ownerUserId)
      .order("started_at", { ascending: true, nullsFirst: false });

    if (transcriptionsError) {
      throw transcriptionsError;
    }

    const input = buildConversationEmbeddingInput({
      id: conversation.id,
      fieldyId: conversation.fieldy_id,
      title: conversation.title ?? "Untitled conversation",
      summary: conversation.summary ?? "",
      content: conversation.content,
      keywords: conversation.keywords,
      transcript: ((transcriptions ?? []) as TranscriptionEmbeddingRow[]).map(
        (transcription) => ({
          speakerLabel: transcription.speaker_label,
          text: transcription.text,
          startedAt: transcription.started_at,
        }),
      ),
    });

    const inputHash = hashConversationEmbeddingInput({
      input,
      embeddingModel,
      inputVersion: CONVERSATION_EMBEDDING_INPUT_VERSION,
    });

    if (conversation.embedding_input_hash === inputHash) {
      skippedCount += 1;
      continue;
    }

    const embedding = await embedText(input);
    const { error: updateError } = await supabase
      .from("conversations")
      .update({
        embedding: JSON.stringify(embedding),
        embedding_model: embeddingModel,
        embedding_input_hash: inputHash,
        embedded_at: now.toISOString(),
        embedding_error: null,
      })
      .match({ id: conversation.id, user_id: ownerUserId });

    if (updateError) {
      throw updateError;
    }

    embeddedCount += 1;
  }

  return { embeddedCount, skippedCount };
}
```

- [ ] **Step 4: Run embedding service tests**

Run:

```bash
node --test --experimental-strip-types tests/conversation-embeddings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/lifelog/conversation-embeddings.ts tests/conversation-embeddings.test.ts
git commit -m "Add conversation embedding service"
```

Expected: commit succeeds.

## Task 5: Add Owner-Only Embedding Server Action

**Files:**
- Create: `lib/lifelog/embed-action-state.ts`
- Create: `app/actions/embed-conversations.ts`
- Create: `tests/embed-action-source.test.ts`

- [ ] **Step 1: Add failing source test**

Create `tests/embed-action-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/actions/embed-conversations.ts", "utf8");

test("embed conversations action is server-only and owner protected", () => {
  assert.match(source, /"use server";/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /user\.id !== getOwnerUserId\(\)/);
  assert.match(source, /createSupabaseAdminClient\(\)/);
  assert.match(source, /createOpenAiEmbeddingClient/);
  assert.match(source, /embedMissingConversations/);
  assert.match(source, /revalidatePath\("\/"\)/);
  assert.doesNotMatch(source, /console\.log/);
});
```

- [ ] **Step 2: Run source test and verify it fails**

Run:

```bash
node --test --experimental-strip-types tests/embed-action-source.test.ts
```

Expected: FAIL because the action file does not exist.

- [ ] **Step 3: Add action state type**

Create `lib/lifelog/embed-action-state.ts`:

```ts
export type EmbedConversationsActionState = {
  status: "idle" | "success" | "error";
  message: string;
  embeddedCount: number | null;
  skippedCount: number | null;
};

export const initialEmbedConversationsActionState: EmbedConversationsActionState = {
  status: "idle",
  message: "",
  embeddedCount: null,
  skippedCount: null,
};
```

- [ ] **Step 4: Add server action**

Create `app/actions/embed-conversations.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { getOpenAiEmbeddingEnv, getOwnerUserId } from "@/lib/env";
import { embedMissingConversations } from "@/lib/lifelog/conversation-embeddings";
import type { EmbedConversationsActionState } from "@/lib/lifelog/embed-action-state";
import { createOpenAiEmbeddingClient } from "@/lib/lifelog/openai-embeddings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function embedConversations(
  _previousState: EmbedConversationsActionState,
  _formData: FormData,
): Promise<EmbedConversationsActionState> {
  const serverSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();
  const ownerUserId = getOwnerUserId();

  if (!user || user.id !== ownerUserId) {
    return {
      status: "error",
      message: "Only the lifelog owner can embed conversations.",
      embeddedCount: null,
      skippedCount: null,
    };
  }

  try {
    const { openAiApiKey, embeddingModel } = getOpenAiEmbeddingEnv();
    const openAi = createOpenAiEmbeddingClient({
      apiKey: openAiApiKey,
      embeddingModel,
    });
    const result = await embedMissingConversations({
      supabase: createSupabaseAdminClient(),
      ownerUserId,
      embeddingModel,
      embedText: openAi.embedText,
    });

    revalidatePath("/");

    return {
      status: "success",
      message: `Embedded ${result.embeddedCount} conversations.`,
      embeddedCount: result.embeddedCount,
      skippedCount: result.skippedCount,
    };
  } catch {
    return {
      status: "error",
      message: "Conversation embedding failed. Check configuration and try again.",
      embeddedCount: null,
      skippedCount: null,
    };
  }
}
```

- [ ] **Step 5: Run source test**

Run:

```bash
node --test --experimental-strip-types tests/embed-action-source.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add app/actions/embed-conversations.ts lib/lifelog/embed-action-state.ts tests/embed-action-source.test.ts
git commit -m "Add owner embedding action"
```

Expected: commit succeeds.

## Task 6: Add Semantic Recall Query Helper

**Files:**
- Create: `lib/lifelog/semantic-recall.ts`
- Create: `tests/semantic-recall.test.ts`

- [ ] **Step 1: Add failing semantic recall tests**

Create `tests/semantic-recall.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECALL_MAX_QUERY_LENGTH,
  normalizeRecallQuery,
  searchSemanticRecall,
} from "../lib/lifelog/semantic-recall.ts";

test("normalizeRecallQuery trims and caps query text", () => {
  assert.equal(normalizeRecallQuery("  budget  "), "budget");
  assert.equal(normalizeRecallQuery("x".repeat(1000)).length, RECALL_MAX_QUERY_LENGTH);
});

test("searchSemanticRecall embeds query and calls match_conversations RPC", async () => {
  const calls: unknown[] = [];
  const supabase = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({
        data: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            title: "Budget",
            summary: "Planning",
            started_at: "2026-06-17T15:00:00.000Z",
            ended_at: null,
            keywords: ["budget"],
            similarity: 0.82,
          },
        ],
        error: null,
      });
    },
  };

  const result = await searchSemanticRecall({
    supabase: supabase as never,
    query: "budget planning",
    embedText: async (input) => {
      assert.equal(input, "budget planning");
      return [0.1, 0.2, 0.3];
    },
  });

  assert.deepEqual(calls, [
    {
      name: "match_conversations",
      args: {
        query_embedding: [0.1, 0.2, 0.3],
        match_count: 10,
        match_threshold: 0.7,
      },
    },
  ]);
  assert.equal(result.query, "budget planning");
  assert.equal(result.results[0]?.title, "Budget");
  assert.equal(result.results[0]?.similarity, 0.82);
});

test("searchSemanticRecall does not embed blank queries", async () => {
  const result = await searchSemanticRecall({
    supabase: { rpc: () => Promise.reject(new Error("should not search")) } as never,
    query: "   ",
    embedText: async () => {
      throw new Error("should not embed blank query");
    },
  });

  assert.deepEqual(result, { query: "", results: [] });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/semantic-recall.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement semantic recall helper**

Create `lib/lifelog/semantic-recall.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

export const RECALL_MAX_QUERY_LENGTH = 300;
export const RECALL_MATCH_COUNT = 10;
export const RECALL_MATCH_THRESHOLD = 0.7;

type SemanticRecallRpcRow = {
  id: string;
  title: string | null;
  summary: string | null;
  started_at: string | null;
  ended_at: string | null;
  keywords: string[] | null;
  similarity: number;
};

export type SemanticRecallResult = {
  id: string;
  title: string;
  summary: string;
  startedAt: string | null;
  endedAt: string | null;
  keywords: string[];
  similarity: number;
};

export function normalizeRecallQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, RECALL_MAX_QUERY_LENGTH);
}

export async function searchSemanticRecall({
  supabase,
  query,
  embedText,
  matchCount = RECALL_MATCH_COUNT,
  matchThreshold = RECALL_MATCH_THRESHOLD,
}: {
  supabase: SupabaseClient<Database>;
  query: string;
  embedText: (input: string) => Promise<number[]>;
  matchCount?: number;
  matchThreshold?: number;
}) {
  const normalizedQuery = normalizeRecallQuery(query);
  if (!normalizedQuery) {
    return { query: "", results: [] };
  }

  const embedding = await embedText(normalizedQuery);
  const { data, error } = await supabase.rpc("match_conversations", {
    query_embedding: embedding,
    match_count: matchCount,
    match_threshold: matchThreshold,
  });

  if (error) {
    throw error;
  }

  return {
    query: normalizedQuery,
    results: ((data ?? []) as SemanticRecallRpcRow[]).map((row) => ({
      id: row.id,
      title: row.title ?? "Untitled conversation",
      summary: row.summary ?? "No summary available yet.",
      startedAt: row.started_at,
      endedAt: row.ended_at,
      keywords: row.keywords ?? [],
      similarity: row.similarity,
    })),
  };
}
```

- [ ] **Step 4: Run semantic recall tests**

Run:

```bash
node --test --experimental-strip-types tests/semantic-recall.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/lifelog/semantic-recall.ts tests/semantic-recall.test.ts
git commit -m "Add semantic recall search helper"
```

Expected: commit succeeds.

## Task 7: Wire Recall Search Into The Dashboard

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/lifelog-dashboard.tsx`
- Modify: `app/globals.css`
- Create: `tests/semantic-recall-page-source.test.ts`
- Modify: `tests/dashboard-ui-source.test.ts`

- [ ] **Step 1: Add failing page source test**

Create `tests/semantic-recall-page-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/page.tsx", "utf8");

test("dashboard page loads semantic recall results from authenticated server context", () => {
  assert.match(source, /searchSemanticRecall/);
  assert.match(source, /getOpenAiEmbeddingEnv/);
  assert.match(source, /createOpenAiEmbeddingClient/);
  assert.match(source, /recallQuery/);
  assert.match(source, /semanticRecall/);
  assert.doesNotMatch(source, /createSupabaseAdminClient/);
});
```

- [ ] **Step 2: Add failing dashboard source assertions**

Append to `tests/dashboard-ui-source.test.ts`:

```ts
test("dashboard exposes semantic recall search and embedding action", () => {
  assert.match(source, /embedConversations/);
  assert.match(source, /initialEmbedConversationsActionState/);
  assert.match(source, /name="recall"/);
  assert.match(source, /Semantic recall/);
  assert.match(source, /similarity/);
  assert.match(source, /Embed conversations/);
});
```

- [ ] **Step 3: Run source tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/semantic-recall-page-source.test.ts tests/dashboard-ui-source.test.ts
```

Expected: FAIL because the page and dashboard are not wired yet.

- [ ] **Step 4: Update `app/page.tsx`**

Modify `app/page.tsx` so it imports and calls semantic recall only when `recall` query text is present:

```ts
import { redirect } from "next/navigation";
import { LifelogDashboard } from "@/components/lifelog-dashboard";
import {
  getDisplayTimeZone,
  getOpenAiEmbeddingEnv,
  getOwnerUserId,
} from "@/lib/env";
import { getDashboardData } from "@/lib/lifelog/dashboard-data";
import { normalizeDashboardQuery } from "@/lib/lifelog/dashboard-query";
import { createOpenAiEmbeddingClient } from "@/lib/lifelog/openai-embeddings";
import {
  normalizeRecallQuery,
  searchSemanticRecall,
} from "@/lib/lifelog/semantic-recall";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function readFirstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (user.id !== getOwnerUserId()) {
    redirect("/login?error=invalid_credentials");
  }

  const resolvedSearchParams = await searchParams;
  const displayTimeZone = getDisplayTimeZone();
  const renderedAt = new Date();
  const dashboardQuery = normalizeDashboardQuery(resolvedSearchParams);
  const dashboardData = await getDashboardData(supabase, {
    userId: user.id,
    query: dashboardQuery,
    displayTimeZone,
    now: renderedAt,
  });
  const recallQuery = normalizeRecallQuery(readFirstParam(resolvedSearchParams.recall));
  const semanticRecall = recallQuery
    ? await searchSemanticRecall({
        supabase,
        query: recallQuery,
        embedText: createOpenAiEmbeddingClient(getOpenAiEmbeddingEnv()).embedText,
      })
    : { query: "", results: [] };

  return (
    <LifelogDashboard
      data={dashboardData}
      displayTimeZone={displayTimeZone}
      renderedAt={renderedAt.toISOString()}
      semanticRecall={semanticRecall}
    />
  );
}
```

- [ ] **Step 5: Update `components/lifelog-dashboard.tsx`**

Add imports:

```ts
import { embedConversations } from "@/app/actions/embed-conversations";
import {
  initialEmbedConversationsActionState,
  type EmbedConversationsActionState,
} from "@/lib/lifelog/embed-action-state";
import type { SemanticRecallResult } from "@/lib/lifelog/semantic-recall";
```

Extend props:

```ts
semanticRecall: {
  query: string;
  results: SemanticRecallResult[];
};
```

Add action state near the existing backfill state:

```ts
const [embedState, embedAction, isEmbedPending] = useActionState(
  embedConversations as (
    state: EmbedConversationsActionState,
    formData: FormData,
  ) => Promise<EmbedConversationsActionState>,
  initialEmbedConversationsActionState,
);
```

Add a recall submit handler:

```ts
function handleSemanticRecallSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const recall = String(formData.get("recall") ?? "").trim();
  navigateWith({ recall: recall || null });
}
```

Update `buildQueryString` to preserve `recall`:

```ts
if (semanticRecall.query) params.set("recall", semanticRecall.query);
```

Render this panel in the right rail above the current preview recall panel:

```tsx
<section className="rail-panel semantic-recall-panel">
  <div className="rail-header">
    <h2>Semantic recall</h2>
    <span>{semanticRecall.results.length}</span>
  </div>
  <form className="semantic-recall-form" onSubmit={handleSemanticRecallSubmit}>
    <Search aria-hidden="true" size={18} />
    <input
      defaultValue={semanticRecall.query}
      key={semanticRecall.query}
      name="recall"
      placeholder="Find memories by meaning..."
      type="search"
    />
    <button disabled={isNavigating} type="submit">
      Search
    </button>
  </form>
  <form action={embedAction}>
    <button
      className="embed-button"
      disabled={isEmbedPending}
      type="submit"
    >
      <Sparkles aria-hidden="true" size={17} />
      <span>{isEmbedPending ? "Embedding..." : "Embed conversations"}</span>
    </button>
  </form>
  {embedState.message ? (
    <p className={`sync-action-message sync-action-${embedState.status}`}>
      {embedState.message}
    </p>
  ) : null}
  <div className="semantic-recall-results">
    {semanticRecall.results.map((result) => (
      <Link
        className="semantic-recall-result"
        href={`/conversations/${result.id}${
          currentFromQuery ? `?from=${encodeURIComponent(currentFromQuery)}` : ""
        }`}
        key={result.id}
      >
        <strong>{result.title}</strong>
        <span>{result.summary}</span>
        <em>{Math.round(result.similarity * 100)}% similarity</em>
      </Link>
    ))}
  </div>
</section>
```

- [ ] **Step 6: Add CSS**

Append to `app/globals.css`:

```css
.semantic-recall-panel {
  gap: 14px;
}

.semantic-recall-form {
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  display: grid;
  gap: 8px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 8px 10px;
}

.semantic-recall-form input {
  background: transparent;
  border: 0;
  color: inherit;
  min-width: 0;
  outline: 0;
}

.embed-button {
  align-items: center;
  border-radius: 8px;
  display: inline-flex;
  gap: 8px;
  justify-content: center;
  min-height: 40px;
  width: 100%;
}

.semantic-recall-results {
  display: grid;
  gap: 8px;
}

.semantic-recall-result {
  border: 1px solid var(--border);
  border-radius: 8px;
  color: inherit;
  display: grid;
  gap: 5px;
  padding: 10px;
  text-decoration: none;
}

.semantic-recall-result span {
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.35;
}

.semantic-recall-result em {
  color: var(--accent);
  font-size: 0.78rem;
  font-style: normal;
}
```

- [ ] **Step 7: Run source tests**

Run:

```bash
node --test --experimental-strip-types tests/semantic-recall-page-source.test.ts tests/dashboard-ui-source.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add app/page.tsx components/lifelog-dashboard.tsx app/globals.css tests/semantic-recall-page-source.test.ts tests/dashboard-ui-source.test.ts
git commit -m "Wire semantic recall into dashboard"
```

Expected: commit succeeds.

## Task 8: Update Types, Docs, And Verification

**Files:**
- Modify: `lib/supabase/types.ts`
- Modify: `README.md`

- [ ] **Step 1: Update Supabase types**

Regenerate Supabase types if the project is linked:

```bash
npx supabase gen types typescript --linked > lib/supabase/types.ts
```

If the Supabase CLI is unavailable, manually add the new nullable conversation columns and the `match_conversations` RPC shape to `lib/supabase/types.ts`.

Expected: `Database["public"]["Tables"]["conversations"]["Row"]` includes `embedding`, `embedding_model`, `embedding_input_hash`, `embedded_at`, and `embedding_error`.

- [ ] **Step 2: Update README env and setup docs**

Add this to the required environment block in `README.md`:

```bash
OPENAI_API_KEY=sk-...
LIFELOG_EMBEDDING_MODEL=text-embedding-3-small
```

Add this to the Supabase setup section:

```markdown
Apply `supabase/migrations/20260617000000_semantic_recall_v1.sql` after the private owner foundation migration to enable pgvector semantic recall. The migration adds conversation embeddings and an owner-scoped `match_conversations` RPC.
```

Add this to verification:

```markdown
After importing Fieldy conversations, run **Embed conversations** from the dashboard before using Semantic recall. Embeddings are private app data and should be treated like transcript content.
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all commands pass.

- [ ] **Step 4: Context7-backed subagent review**

Dispatch a code review subagent with these instructions:

```text
Review the Semantic Recall V1 changes in /Users/jonmossie/Documents/GitHub/lifelog.
Use Context7 docs for Supabase pgvector/RPC/RLS and OpenAI embeddings before reviewing.
Focus on privacy boundaries, RLS/auth behavior, server-only secrets, embedding idempotency, and test coverage.
Return findings first, ordered by severity, with file/line references.
```

Expected: no blocking findings. Fix any findings before completing the branch.

- [ ] **Step 5: Final commit**

Run:

```bash
git add lib/supabase/types.ts README.md
git commit -m "Document semantic recall setup"
```

Expected: commit succeeds.

## Self-Review

- Spec coverage: migration, env, embedding input, OpenAI embedding call, idempotent embedding job, owner-only action, semantic RPC search, UI wiring, docs, and verification are all covered.
- Placeholder scan: no placeholder markers or undefined future-only tasks are required to make Semantic Recall v1 useful.
- Type consistency: `SemanticRecallResult`, `EmbedConversationsActionState`, `searchSemanticRecall`, `embedMissingConversations`, and `match_conversations` are named consistently across tasks.

## Execution Choice

Plan complete and saved to `docs/superpowers/plans/2026-06-17-semantic-recall-v1.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.
