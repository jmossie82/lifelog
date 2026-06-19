# Recall Chat Persistence V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist owner-only Recall Chat sessions and messages so `/chat` can reload prior private chat history with cited lifelog sources.

**Architecture:** Store chat sessions and messages in Supabase behind owner-scoped RLS, and keep the server authoritative for saved history. The client may hold a session id, but the route loads trusted stored messages, appends the latest bounded user text, streams with AI SDK UI messages, and saves the completed turn in `toUIMessageStreamResponse({ onFinish })`.

**Tech Stack:** Next.js App Router 16.2.9, React 19.2.1, TypeScript strict mode, Vercel AI SDK 6, `@ai-sdk/react`, Supabase SSR/RLS, OpenAI embeddings/responses, Node `node:test`, existing CSS/lucide-react UI.

---

## Context And Current Docs

Context7 checks performed before writing this plan:

```bash
npx ctx7@latest library "Vercel AI SDK" "plan next slice for lifelog Recall Chat persistence with AI SDK 6 streaming Next.js App Router toUIMessageStreamResponse useChat messages onFinish persistence"
npx ctx7@latest docs /vercel/ai "AI SDK 6 streaming chat persistence Next.js App Router toUIMessageStreamResponse toUIMessageStream onFinish useChat messages append metadata save chat messages"
```

Relevant current AI SDK 6 shape from Context7 and installed types:

- `streamText(...).toUIMessageStreamResponse({ originalMessages, generateMessageId, onFinish })` is the direct persistence hook for UI messages.
- `onFinish` receives `{ messages, responseMessage, isAborted, finishReason }`, which allows saving the completed assistant response after streaming ends.
- `DefaultChatTransport` accepts `prepareSendMessagesRequest`, whose installed type receives `{ id, messages, body, trigger, messageId }` and returns a custom `{ body }`.
- `convertToModelMessages(messages)` should receive trusted server-built `UIMessage[]`; do not forward raw client history into the model.

## Product Scope

This slice adds:

- Supabase tables for `recall_chat_sessions` and `recall_chat_messages`.
- Owner-only RLS policies for reading and writing those chat rows.
- Typed Supabase table entries for the new tables.
- Server helpers to normalize chat ids, create/load sessions, list recent sessions, load stored messages, and persist completed turns.
- `/api/recall-chat` support for an optional `chatId`, server-loaded stored history, and AI SDK `onFinish` persistence.
- `/chat` support for starting a new chat, opening prior chats, and rendering persisted messages.
- Focused tests for schema, helper behavior, source contracts, and UI contract.

This slice does not add:

- Chat deletion.
- Sharing or multi-user chat.
- Streaming reconnection.
- Message editing/regeneration.
- Transcript chunk embeddings.
- New UI framework or external state manager.

## File Structure

- Create `supabase/migrations/20260618000000_recall_chat_persistence_v1.sql`: chat session/message tables, indexes, triggers, and owner-only RLS policies.
- Modify `lib/supabase/types.ts`: add table types for `recall_chat_sessions` and `recall_chat_messages`.
- Modify `tests/supabase-schema.test.ts`: assert schema, policies, constraints, and no public grants.
- Create `lib/lifelog/recall-chat-persistence.ts`: pure normalization plus Supabase read/write helpers.
- Create `tests/recall-chat-persistence.test.ts`: pure helper tests and fake-client query-shape tests.
- Modify `lib/lifelog/recall-chat.ts`: add a bounded model-message builder that accepts trusted stored messages plus latest user text.
- Modify `tests/recall-chat.test.ts`: cover persisted-history model input bounds.
- Modify `app/api/recall-chat/route.ts`: accept `chatId`, load trusted messages, stream from server-built input, and persist completed turns.
- Extend `tests/recall-chat-route-source.test.ts`: assert persistence order and AI SDK stream callback usage.
- Update `app/chat/page.tsx`: load recent sessions and optional selected session.
- Enhance `components/recall-chat.tsx`: add session list, new-chat button, selected session id state, initial messages, and transport body.
- Cover `tests/recall-chat-page-source.test.ts` and `tests/recall-chat-ui-source.test.ts`: assert page and UI contracts.
- Style `app/globals.css`: add restrained session-list styles within the existing chat page.

---

### Task 1: Add Recall Chat Persistence Schema

**Files:**
- Create: `supabase/migrations/20260618000000_recall_chat_persistence_v1.sql`
- Modify: `lib/supabase/types.ts`
- Modify: `tests/supabase-schema.test.ts`

- [ ] **Step 1: Add failing schema tests**

Append to `tests/supabase-schema.test.ts`:

```ts
const recallChatPersistenceMigration = readFileSync(
  "supabase/migrations/20260618000000_recall_chat_persistence_v1.sql",
  "utf8",
);

const normalizedRecallChatPersistenceMigration =
  recallChatPersistenceMigration.replace(/\s+/g, " ").trim();

test("recall chat persistence migration creates owner-scoped tables", () => {
  assert.match(recallChatPersistenceMigration, /create table public\.recall_chat_sessions/);
  assert.match(recallChatPersistenceMigration, /create table public\.recall_chat_messages/);
  assert.match(recallChatPersistenceMigration, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(recallChatPersistenceMigration, /unique \(user_id, id\)/);
  assert.match(
    normalizedRecallChatPersistenceMigration,
    /foreign key \(user_id, session_id\) references public\.recall_chat_sessions\(user_id, id\) on delete cascade/,
  );
  assert.match(recallChatPersistenceMigration, /role text not null check \(role in \('user', 'assistant'\)\)/);
  assert.match(recallChatPersistenceMigration, /turn_id uuid not null/);
  assert.match(recallChatPersistenceMigration, /message_order integer not null check \(message_order > 0\)/);
  assert.match(recallChatPersistenceMigration, /unique \(session_id, turn_id, role\)/);
  assert.match(recallChatPersistenceMigration, /unique \(session_id, message_order\)/);
  assert.match(recallChatPersistenceMigration, /parts jsonb not null/);
  assert.match(recallChatPersistenceMigration, /source_citations jsonb not null default '\[\]'::jsonb/);
  assert.doesNotMatch(recallChatPersistenceMigration, /raw_prompt/);
  assert.doesNotMatch(recallChatPersistenceMigration, /api_key/);
});

test("recall chat persistence migration enables owner-only RLS writes", () => {
  for (const table of ["recall_chat_sessions", "recall_chat_messages"]) {
    assert.match(
      recallChatPersistenceMigration,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
    assert.match(
      normalizedRecallChatPersistenceMigration,
      new RegExp(`on public\\.${table} for select to authenticated using \\(public\\.is_lifelog_owner\\(user_id\\)\\);`),
    );
    assert.match(
      normalizedRecallChatPersistenceMigration,
      new RegExp(`on public\\.${table} for insert to authenticated with check \\(public\\.is_lifelog_owner\\(user_id\\)\\);`),
    );
    assert.match(
      normalizedRecallChatPersistenceMigration,
      new RegExp(`on public\\.${table} for update to authenticated using \\(public\\.is_lifelog_owner\\(user_id\\)\\) with check \\(public\\.is_lifelog_owner\\(user_id\\)\\);`),
    );
    assert.doesNotMatch(
      normalizedRecallChatPersistenceMigration,
      new RegExp(`on public\\.${table}[^;]+to public;`),
    );
  }
});
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/supabase-schema.test.ts
```

Expected: FAIL because `supabase/migrations/20260618000000_recall_chat_persistence_v1.sql` does not exist.

- [ ] **Step 3: Create the migration**

Create `supabase/migrations/20260618000000_recall_chat_persistence_v1.sql`:

```sql
create table public.recall_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  latest_user_text text,
  source_count integer not null default 0 check (source_count >= 0),
  message_count integer not null default 0 check (message_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.recall_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  turn_id uuid not null,
  message_order integer not null check (message_order > 0),
  role text not null check (role in ('user', 'assistant')),
  parts jsonb not null,
  source_citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (user_id, session_id)
    references public.recall_chat_sessions(user_id, id)
    on delete cascade,
  unique (session_id, turn_id, role),
  unique (session_id, message_order)
);

create index recall_chat_sessions_user_updated_at_idx
  on public.recall_chat_sessions (user_id, updated_at desc);

create index recall_chat_messages_session_order_idx
  on public.recall_chat_messages (session_id, message_order desc);

create trigger recall_chat_sessions_set_updated_at
  before update on public.recall_chat_sessions
  for each row execute function public.set_updated_at();

alter table public.recall_chat_sessions enable row level security;
alter table public.recall_chat_messages enable row level security;

create policy "Owner can read recall chat sessions"
  on public.recall_chat_sessions for select
  to authenticated
  using (public.is_lifelog_owner(user_id));

create policy "Owner can insert recall chat sessions"
  on public.recall_chat_sessions for insert
  to authenticated
  with check (public.is_lifelog_owner(user_id));

create policy "Owner can update recall chat sessions"
  on public.recall_chat_sessions for update
  to authenticated
  using (public.is_lifelog_owner(user_id))
  with check (public.is_lifelog_owner(user_id));

create policy "Owner can read recall chat messages"
  on public.recall_chat_messages for select
  to authenticated
  using (public.is_lifelog_owner(user_id));

create policy "Owner can insert recall chat messages"
  on public.recall_chat_messages for insert
  to authenticated
  with check (public.is_lifelog_owner(user_id));

create policy "Owner can update recall chat messages"
  on public.recall_chat_messages for update
  to authenticated
  using (public.is_lifelog_owner(user_id))
  with check (public.is_lifelog_owner(user_id));
```

- [ ] **Step 4: Add Supabase table types**

In `lib/supabase/types.ts`, add these tables inside `Database["public"]["Tables"]`:

```ts
      recall_chat_sessions: Row<{
        id: string;
        user_id: string;
        title: string;
        latest_user_text: string | null;
        source_count: number;
        message_count: number;
        created_at: string;
        updated_at: string;
      }>;
      recall_chat_messages: Row<{
        id: string;
        user_id: string;
        session_id: string;
        role: "user" | "assistant";
        parts: Json;
        source_citations: Json;
        created_at: string;
      }>;
```

- [ ] **Step 5: Run schema tests**

Run:

```bash
node --test --experimental-strip-types tests/supabase-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add supabase/migrations/20260618000000_recall_chat_persistence_v1.sql lib/supabase/types.ts tests/supabase-schema.test.ts
git commit -m "Add Recall Chat persistence schema"
```

Expected: commit succeeds.

---

### Task 2: Add Recall Chat Persistence Helpers

**Files:**
- Create: `lib/lifelog/recall-chat-persistence.ts`
- Create: `tests/recall-chat-persistence.test.ts`
- Modify: `lib/lifelog/recall-chat.ts`
- Modify: `tests/recall-chat.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/recall-chat-persistence.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRecallChatSessionTitle,
  mapRecallChatMessageRow,
  normalizeRecallChatSessionId,
  serializeRecallChatMessageParts,
} from "../lib/lifelog/recall-chat-persistence.ts";

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
    createRecallChatSessionTitle("  What did I promise in the June sales call about invoices and follow-up?  "),
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
```

Add `buildRecallChatModelMessagesForTurn` to the existing import from `../lib/lifelog/recall-chat.ts`, then append this test:

```ts
test("buildRecallChatModelMessagesForTurn keeps trusted bounded history plus latest user text", () => {
  const messages = buildRecallChatModelMessagesForTurn({
    storedMessages: [
      {
        id: "stored-user",
        role: "user",
        parts: [{ type: "text", text: "Earlier question" }],
      },
      {
        id: "stored-assistant",
        role: "assistant",
        parts: [{ type: "text", text: "Earlier answer" }],
      },
    ],
    latestUserText: "Latest question",
  });

  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal(messages.at(-1)?.parts[0]?.type, "text");
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
node --conditions react-server --test --experimental-strip-types tests/recall-chat-persistence.test.ts tests/recall-chat.test.ts
```

Expected: FAIL because `lib/lifelog/recall-chat-persistence.ts` and `buildRecallChatModelMessagesForTurn` do not exist.

- [ ] **Step 3: Implement pure persistence helpers**

Create `lib/lifelog/recall-chat-persistence.ts`:

```ts
import type { UIMessage } from "ai";

import type { Json } from "@/lib/supabase/types";

export const RECALL_CHAT_SESSION_TITLE_LENGTH = 60;
export const RECALL_CHAT_MESSAGE_TEXT_LENGTH = 1000;
export const RECALL_CHAT_MAX_STORED_MESSAGES = 40;
export const RECALL_CHAT_MAX_SESSIONS = 20;

type RecallChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  parts: Json;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeRecallChatSessionId(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function createRecallChatSessionTitle(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return "New Recall chat";
  if (normalized.length <= RECALL_CHAT_SESSION_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, RECALL_CHAT_SESSION_TITLE_LENGTH - 3)}...`;
}

export function serializeRecallChatMessageParts(parts: unknown) {
  if (!Array.isArray(parts)) return [];

  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => ({
      type: "text" as const,
      text: normalizeText(part.text).slice(0, RECALL_CHAT_MESSAGE_TEXT_LENGTH),
    }))
    .filter((part) => part.text.length > 0);
}

export function mapRecallChatMessageRow(row: RecallChatMessageRow): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: serializeRecallChatMessageParts(row.parts),
  };
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
```

- [ ] **Step 4: Add trusted persisted-history model builder**

In `lib/lifelog/recall-chat.ts`, add:

```ts
export function buildRecallChatModelMessagesForTurn({
  storedMessages,
  latestUserText,
}: {
  storedMessages: UIMessage[];
  latestUserText: string;
}) {
  const normalizedText = normalizeRecallChatUserText(latestUserText);
  const trustedHistory = trimRecallChatHistory(storedMessages).flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const text = normalizeRecallChatUserText(
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" "),
    );
    if (!text) return [];
    return [
      {
        id: message.id,
        role: message.role,
        parts: [{ type: "text" as const, text }],
      },
    ];
  });

  if (!normalizedText) {
    return trustedHistory;
  }

  return [
    ...trustedHistory,
    {
      id: "recall-chat-latest-user-message",
      role: "user" as const,
      parts: [{ type: "text" as const, text: normalizedText }],
    },
  ];
}
```

- [ ] **Step 5: Run helper tests**

Run:

```bash
node --conditions react-server --test --experimental-strip-types tests/recall-chat-persistence.test.ts tests/recall-chat.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/lifelog/recall-chat-persistence.ts lib/lifelog/recall-chat.ts tests/recall-chat-persistence.test.ts tests/recall-chat.test.ts
git commit -m "Add Recall Chat persistence helpers"
```

Expected: commit succeeds.

---

### Task 3: Add Supabase Persistence Operations

**Files:**
- Modify: `lib/lifelog/recall-chat-persistence.ts`
- Modify: `tests/recall-chat-persistence.test.ts`

- [ ] **Step 1: Add failing fake-client operation tests**

Add `ensureRecallChatSession`, `getRecallChatMessages`, `getRecallChatSessions`, and `saveRecallChatTurn` to the existing import from `../lib/lifelog/recall-chat-persistence.ts`, then append these tests:

```ts
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

  assert.ok(JSON.stringify(calls).includes("recall_chat_sessions"));
  assert.ok(JSON.stringify(calls).includes("Latest question"));
});

test("saveRecallChatTurn inserts user and assistant messages then updates the session summary", async () => {
  const calls: unknown[] = [];
  const supabase = createFakeSupabase(calls, {
    recall_chat_messages: { data: null, error: null },
    recall_chat_sessions: { data: null, error: null },
  });

  await saveRecallChatTurn(supabase, {
    userId: "user-1",
    sessionId: "00000000-0000-4000-8000-000000000001",
    latestUserText: "Latest question",
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Answer [S1]" }],
    },
    sources: [{ citationId: "S1", conversationId: "conversation-1", title: "Sales call" }],
  });

  assert.ok(JSON.stringify(calls).includes("recall_chat_messages"));
  assert.ok(JSON.stringify(calls).includes("recall_chat_sessions"));
  assert.ok(JSON.stringify(calls).includes("Answer [S1]"));
});
```

Also add this fake client helper to the same test file:

```ts
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
        upsert(value: unknown) {
          calls.push(["upsert", value]);
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
        then(resolve: (value: unknown) => void) {
          return Promise.resolve(result).then(resolve);
        },
      };
      return builder;
    },
  };
}
```

- [ ] **Step 2: Run persistence tests and verify they fail**

Run:

```bash
node --conditions react-server --test --experimental-strip-types tests/recall-chat-persistence.test.ts
```

Expected: FAIL because the Supabase operation helpers are not exported.

- [ ] **Step 3: Implement Supabase operation helpers**

Add these imports at the top of `lib/lifelog/recall-chat-persistence.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";
```

Then append these types and functions below `mapRecallChatMessageRow`:

```ts

type LifelogSupabaseClient = SupabaseClient<Database>;

type RecallChatSessionRow =
  Database["public"]["Tables"]["recall_chat_sessions"]["Row"];

export type RecallChatSessionSummary = {
  id: string;
  title: string;
  latestUserText: string | null;
  sourceCount: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RecallChatSourceCitation = {
  citationId: string;
  conversationId: string;
  title: string;
};

export async function getRecallChatSessions(
  supabase: LifelogSupabaseClient,
  { userId }: { userId: string },
) {
  const { data, error } = await supabase
    .from("recall_chat_sessions")
    .select("id, title, latest_user_text, source_count, message_count, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(RECALL_CHAT_MAX_SESSIONS);

  if (error) throw error;
  return (data ?? []).map(mapRecallChatSessionRow);
}

export async function getRecallChatMessages(
  supabase: LifelogSupabaseClient,
  { sessionId, userId }: { sessionId: string; userId: string },
) {
  const { data, error } = await supabase
    .from("recall_chat_messages")
    .select("id, role, parts, source_citations, message_order, created_at")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("message_order", { ascending: false })
    .limit(RECALL_CHAT_MAX_STORED_MESSAGES);

  if (error) throw error;
  return [...(data ?? [])]
    .reverse()
    .map((row) => mapRecallChatMessageRow(row as RecallChatMessageRow));
}

export async function ensureRecallChatSession(
  supabase: LifelogSupabaseClient,
  {
    latestUserText,
    sessionId,
    userId,
  }: {
    latestUserText: string;
    sessionId: string;
    userId: string;
  },
) {
  const { data, error } = await supabase
    .from("recall_chat_sessions")
    .upsert(
      {
        id: sessionId,
        user_id: userId,
        title: createRecallChatSessionTitle(latestUserText),
        latest_user_text: latestUserText,
      },
      { onConflict: "user_id,id" },
    )
    .select("id, title, latest_user_text, source_count, message_count, created_at, updated_at")
    .single();

  if (error) throw error;
  return mapRecallChatSessionRow(data as RecallChatSessionRow);
}

export async function saveRecallChatTurn(
  supabase: LifelogSupabaseClient,
  {
    latestUserText,
    responseMessage,
    sessionId,
    sources,
    turnId,
    userId,
  }: {
    latestUserText: string;
    responseMessage: UIMessage;
    sessionId: string;
    sources: RecallChatSourceCitation[];
    turnId: string;
    userId: string;
  },
) {
  const sourceCitations = serializeRecallChatSourceCitations(sources);
  const { error } = await supabase.rpc("save_recall_chat_turn", {
    session_user_id: userId,
    chat_session_id: sessionId,
    turn_id_value: turnId,
    latest_user_text_value: latestUserText,
    user_parts_value: [{ type: "text", text: latestUserText }],
    assistant_parts_value: serializeRecallChatMessageParts(responseMessage.parts),
    source_citations_value: sourceCitations,
  });

  if (error) throw error;
}

function mapRecallChatSessionRow(row: RecallChatSessionRow): RecallChatSessionSummary {
  return {
    id: row.id,
    title: row.title,
    latestUserText: row.latest_user_text,
    sourceCount: row.source_count,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 4: Keep turn save atomic and idempotent**

Use the `save_recall_chat_turn` RPC to insert both messages, derive `source_count`
from `source_citations_value`, and increment `message_count` in the same
transaction. The function should de-duplicate retries with
`unique (session_id, turn_id, role)` and order messages with `message_order`.

- [ ] **Step 5: Run persistence tests**

Run:

```bash
node --conditions react-server --test --experimental-strip-types tests/recall-chat-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add lib/lifelog/recall-chat-persistence.ts tests/recall-chat-persistence.test.ts
git commit -m "Add Recall Chat Supabase persistence"
```

Expected: commit succeeds.

---

### Task 4: Persist Completed Recall Chat Turns In The Route

**Files:**
- Modify: `app/api/recall-chat/route.ts`
- Modify: `tests/recall-chat-route-source.test.ts`

- [ ] **Step 1: Add failing route source tests**

In the existing `recall chat route streams UI messages with AI SDK 6` test, replace:

```ts
  assert.match(source, /toUIMessageStreamResponse\(\)/);
```

with:

```ts
  assert.match(source, /toUIMessageStreamResponse\(/);
```

Append to `tests/recall-chat-route-source.test.ts`:

```ts
test("recall chat route persists completed UI messages with AI SDK onFinish", () => {
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /normalizeRecallChatSessionId/);
  assert.match(source, /ensureRecallChatSession/);
  assert.match(source, /getRecallChatMessages/);
  assert.match(source, /buildRecallChatModelMessagesForTurn/);
  assert.match(source, /toUIMessageStreamResponse\(\{\s*originalMessages:/);
  assert.match(source, /generateMessageId:\s*\(\) => crypto\.randomUUID\(\)/);
  assert.match(source, /onFinish:\s*async \(\{ responseMessage, isAborted \}\)/);
  assert.match(source, /if \(isAborted\) return/);
  assert.match(source, /saveRecallChatTurn/);
});

test("recall chat route does not trust raw client history for persistence or model input", () => {
  assert.doesNotMatch(source, /convertToModelMessages\(messages\)/);
  assert.doesNotMatch(source, /saveRecallChatTurn\([\s\S]*body\.messages/);
  assert.match(source, /const storedMessages = await getRecallChatMessages/);
  assert.match(source, /const modelMessages = buildRecallChatModelMessagesForTurn/);
});
```

- [ ] **Step 2: Run route source tests and verify they fail**

Run:

```bash
node --conditions react-server --test --experimental-strip-types tests/recall-chat-route-source.test.ts
```

Expected: FAIL because the route still streams without persistence options.

- [ ] **Step 3: Update the route imports**

In `app/api/recall-chat/route.ts`, replace the current recall-chat imports with:

```ts
import {
  buildRecallChatModelMessagesForTurn,
  buildRecallChatSystemPrompt,
  extractLatestUserText,
  getRecallChatSafeErrorMessage,
  parseRecallChatMessages,
  trimRecallChatHistory,
} from "@/lib/lifelog/recall-chat";
import {
  ensureRecallChatSession,
  getRecallChatMessages,
  normalizeRecallChatSessionId,
  saveRecallChatTurn,
} from "@/lib/lifelog/recall-chat-persistence";
import {
  normalizeRecallQuery,
  searchSemanticRecall,
} from "@/lib/lifelog/semantic-recall";
```

- [ ] **Step 4: Update the route body handling and stream response**

Replace the body/session/model-message block in `POST` with:

```ts
    let body: {
      chatId?: unknown;
      id?: unknown;
      messages?: unknown;
    };

    try {
      const parsedBody: unknown = await request.json();

      if (
        typeof parsedBody !== "object" ||
        parsedBody === null ||
        Array.isArray(parsedBody)
      ) {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }

      body = parsedBody as typeof body;
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const clientMessages = trimRecallChatHistory(
      parseRecallChatMessages(body.messages),
    );
    const latestUserText = normalizeRecallQuery(
      extractLatestUserText(clientMessages),
    );

    if (!latestUserText) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const chatId =
      normalizeRecallChatSessionId(body.chatId) ??
      deriveRecallChatSessionId(body.id) ??
      crypto.randomUUID();
    const latestClientUserMessageId =
      extractLatestClientUserMessageId(clientMessages);

    if (!latestClientUserMessageId) {
      return Response.json({ error: "Message id is required" }, { status: 400 });
    }

    const turnId = deriveRecallChatTurnId(chatId, latestClientUserMessageId);

    const storedMessages = await getRecallChatMessages(supabase, {
      sessionId: chatId,
      userId: user.id,
    });
    const modelMessages = buildRecallChatModelMessagesForTurn({
      storedMessages,
      latestUserText,
    });
```

Replace the return statement:

```ts
    return result.toUIMessageStreamResponse();
```

with:

```ts
    return result.toUIMessageStreamResponse({
      originalMessages: [
        ...storedMessages,
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: latestUserText }],
        },
      ],
      generateMessageId: () => crypto.randomUUID(),
      onFinish: async ({ responseMessage, isAborted }) => {
        if (isAborted) return;

        await ensureRecallChatSession(supabase, {
          latestUserText,
          sessionId: chatId,
          userId: user.id,
        });

        await saveRecallChatTurn(supabase, {
          latestUserText,
          responseMessage,
          sessionId: chatId,
          sources: sources.map((source) => ({
            citationId: source.citationId,
            conversationId: source.conversationId,
            title: source.title,
          })),
          turnId,
          userId: user.id,
        });
      },
    });
```

- [ ] **Step 5: Run route source tests**

Run:

```bash
node --conditions react-server --test --experimental-strip-types tests/recall-chat-route-source.test.ts tests/recall-chat.test.ts tests/recall-chat-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add app/api/recall-chat/route.ts tests/recall-chat-route-source.test.ts
git commit -m "Persist Recall Chat turns"
```

Expected: commit succeeds.

---

### Task 5: Add Chat Session History To The UI

**Files:**
- Modify: `app/chat/page.tsx`
- Modify: `components/recall-chat.tsx`
- Modify: `app/globals.css`
- Modify: `tests/recall-chat-page-source.test.ts`
- Modify: `tests/recall-chat-ui-source.test.ts`

- [ ] **Step 1: Add failing page and UI source tests**

Append to `tests/recall-chat-page-source.test.ts`:

```ts
test("recall chat page loads owner sessions and selected stored messages", () => {
  assert.match(pageSource, /searchParams:\s*Promise<Record<string, string \| string\[\] \| undefined>>/);
  assert.match(pageSource, /readFirstSearchParam/);
  assert.match(pageSource, /normalizeRecallChatSessionId/);
  assert.match(pageSource, /getRecallChatSessions/);
  assert.match(pageSource, /getRecallChatMessages/);
  assert.match(pageSource, /initialSessions=/);
  assert.match(pageSource, /initialMessages=/);
  assert.match(pageSource, /selectedChatId=/);
});
```

Append to `tests/recall-chat-ui-source.test.ts`:

```ts
test("recall chat UI sends chat id through DefaultChatTransport", () => {
  assert.match(source, /selectedChatId/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /prepareSendMessagesRequest/);
  assert.match(source, /body:\s*\{\s*chatId: selectedChatId/);
  assert.match(source, /messages,/);
});

test("recall chat UI renders session history and new chat control", () => {
  assert.match(source, /initialSessions/);
  assert.match(source, /initialMessages/);
  assert.match(source, /New chat/);
  assert.match(source, /chat-session-list/);
  assert.match(source, /chat-session-link/);
  assert.match(styles, /\.chat-session-list/);
  assert.match(styles, /\.chat-session-link/);
});
```

- [ ] **Step 2: Run page/UI source tests and verify they fail**

Run:

```bash
node --conditions react-server --test --experimental-strip-types tests/recall-chat-page-source.test.ts tests/recall-chat-ui-source.test.ts
```

Expected: FAIL because `/chat` still renders only `<RecallChat />`.

- [ ] **Step 3: Load sessions in the page**

Replace `app/chat/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { RecallChat } from "@/components/recall-chat";
import { getOwnerUserId } from "@/lib/env";
import {
  getRecallChatMessages,
  getRecallChatSessions,
  normalizeRecallChatSessionId,
} from "@/lib/lifelog/recall-chat-persistence";
import { readFirstSearchParam } from "@/lib/lifelog/conversation-detail-route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  if (user.id !== getOwnerUserId()) {
    redirect("/login?error=invalid_credentials");
  }

  const resolvedSearchParams = await searchParams;
  const selectedChatId = normalizeRecallChatSessionId(
    readFirstSearchParam(resolvedSearchParams.chat),
  );
  const initialSessions = await getRecallChatSessions(supabase, {
    userId: user.id,
  });
  const selectedSessionExists =
    selectedChatId !== null &&
    initialSessions.some((session) => session.id === selectedChatId);
  const initialMessages = selectedSessionExists
    ? await getRecallChatMessages(supabase, {
        sessionId: selectedChatId,
        userId: user.id,
      })
    : [];

  return (
    <RecallChat
      initialMessages={initialMessages}
      initialSessions={initialSessions}
      selectedChatId={selectedSessionExists ? selectedChatId : null}
    />
  );
}
```

- [ ] **Step 4: Update RecallChat props and transport**

In `components/recall-chat.tsx`, update the function signature and state:

```tsx
import type { UIMessage } from "ai";
import type { RecallChatSessionSummary } from "@/lib/lifelog/recall-chat-persistence";

export function RecallChat({
  initialMessages,
  initialSessions,
  selectedChatId,
}: {
  initialMessages: UIMessage[];
  initialSessions: RecallChatSessionSummary[];
  selectedChatId: string | null;
}) {
  const [input, setInput] = useState("");
  const [chatId, setChatId] = useState(
    selectedChatId ?? crypto.randomUUID(),
  );
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/recall-chat",
        prepareSendMessagesRequest({ messages }) {
          return {
            body: {
              chatId,
              messages,
            },
          };
        },
      }),
    [chatId],
  );
  const { error, messages, sendMessage, setMessages, status } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
  });
```

Add the new-chat handler below `isWorking`:

```tsx
  function handleNewChat() {
    const nextChatId = crypto.randomUUID();
    setChatId(nextChatId);
    setMessages([]);
    window.history.replaceState(null, "", "/chat");
  }
```

- [ ] **Step 5: Render session history**

Inside `<section className="chat-shell" ...>`, add this after the header:

```tsx
        <aside className="chat-session-list" aria-label="Recall chat sessions">
          <button type="button" onClick={handleNewChat}>
            New chat
          </button>
          {initialSessions.map((session) => (
            <Link
              aria-current={session.id === chatId ? "page" : undefined}
              className="chat-session-link"
              href={`/chat?chat=${session.id}`}
              key={session.id}
            >
              <strong>{session.title}</strong>
              <span>{session.messageCount} messages</span>
            </Link>
          ))}
        </aside>
```

- [ ] **Step 6: Add session list styles**

Append to `app/globals.css` near the chat styles:

```css
.chat-session-list {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.chat-session-list button,
.chat-session-link {
  align-items: center;
  background: var(--surface-chat);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: inherit;
  display: flex;
  justify-content: space-between;
  min-height: 2.75rem;
  padding: 0.65rem 0.8rem;
  text-decoration: none;
}

.chat-session-link[aria-current="page"] {
  border-color: var(--accent);
}

.chat-session-link strong {
  font-size: 0.9rem;
  font-weight: 650;
}

.chat-session-link span {
  color: var(--text-muted);
  font-size: 0.78rem;
}
```

- [ ] **Step 7: Run page/UI source tests**

Run:

```bash
node --conditions react-server --test --experimental-strip-types tests/recall-chat-page-source.test.ts tests/recall-chat-ui-source.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add app/chat/page.tsx components/recall-chat.tsx app/globals.css tests/recall-chat-page-source.test.ts tests/recall-chat-ui-source.test.ts
git commit -m "Add Recall Chat session history UI"
```

Expected: commit succeeds.

---

### Task 6: Full Verification And Review

**Files:**
- No new files.

- [ ] **Step 1: Run focused Recall Chat tests**

Run:

```bash
node --conditions react-server --test --experimental-strip-types tests/recall-chat.test.ts tests/recall-chat-persistence.test.ts tests/recall-chat-route-source.test.ts tests/recall-chat-page-source.test.ts tests/recall-chat-ui-source.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the repo test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Request Context7-backed subagent review**

Use `superpowers:requesting-code-review` or the available subagent tooling to review the completed changes. The reviewer must use Context7 for AI SDK persistence behavior and check:

```text
Review Recall Chat Persistence V1 in /Users/jonmossie/Documents/GitHub/lifelog.
Use Context7 for Vercel AI SDK 6 persistence docs.
Focus on:
- whether toUIMessageStreamResponse originalMessages/onFinish usage matches installed AI SDK 6 behavior;
- whether raw client history can reach model input or persistence;
- whether Supabase RLS policies preserve owner-only read/write boundaries;
- whether persisted message parts/citations avoid raw transcripts, API keys, owner ids, and hidden prompts;
- whether tests cover the important persistence and UI contracts.
```

Expected: reviewer returns no blocking findings, or blocking findings are fixed before handoff.

- [ ] **Step 6: Final diff check**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` reports no whitespace errors, and status shows only intentional files changed before final commit/PR steps.

## Self-Review

- Spec coverage: the plan covers schema, RLS, server persistence, AI SDK stream persistence, trusted model input, session-loading page behavior, chat UI history, and verification.
- Placeholder scan: no task depends on unresolved marker text, unexpanded handling, or copy-forward cross-references.
- Type consistency: the plan uses `RecallChatSessionSummary`, `RecallChatSourceCitation`, `UIMessage`, `chatId`, `sessionId`, `latestUserText`, and `source_citations` consistently across migration, helpers, route, and UI.
