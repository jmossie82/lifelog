# End-to-End UI Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first functional UI slice for the private Fieldy lifelog app: URL-backed dashboard search/filtering, a sync activity panel, and dedicated conversation detail pages with full transcripts.

**Architecture:** Keep canonical reads in server components and server-side helpers using the authenticated Supabase SSR client so RLS remains the read boundary. Move dashboard query normalization/search construction into focused library helpers, keep the dashboard client component responsible for URL interactions and local pending state, and add a separate conversation-detail data helper plus route.

**Tech Stack:** Next.js App Router 16.2.9, React 19 `useActionState`, TypeScript strict mode, Supabase JS/PostgREST with RLS, Node `node:test`, existing CSS/lucide-react UI.

---

## Context And Docs

Before implementation, refresh current docs with Context7 because this work touches Next.js Server Actions/App Router and Supabase PostgREST filters:

```bash
npx ctx7@latest library Next.js "Next.js App Router searchParams params Promise useActionState server action form pending state"
npx ctx7@latest docs /vercel/next.js "Next.js App Router searchParams params Promise useActionState server action form pending state"
npx ctx7@latest library Supabase "supabase-js PostgREST ilike or filter range count exact maybeSingle TypeScript"
npx ctx7@latest docs /supabase/supabase "supabase-js PostgREST ilike or filter range count exact maybeSingle TypeScript"
```

Expected: commands return current docs. If quota fails, stop and report the quota issue. If DNS/network fails in the sandbox, rerun outside the sandbox per `AGENTS.md`.

## File Structure

- Create `lib/lifelog/dashboard-query.ts`: pure URL param normalization, date range calculation, PostgREST search filter construction, page constants, and filter metadata.
- Modify `lib/lifelog/dashboard-data.ts`: accept normalized dashboard query options, apply server-backed search/type/range/pagination in Supabase, return pagination metadata, and map sync runs through a safe display boundary.
- Modify `app/page.tsx`: accept async Next 16 `searchParams`, normalize them once, pass query state and dashboard data to the dashboard component.
- Create `lib/lifelog/backfill-action-state.ts`: shared action-state type and initial state for the sync form. Keep this out of `"use server"` files because Next server-action modules may only export async actions.
- Modify `app/actions/backfill-fieldy.ts`: expose `BackfillActionState` and adapt `backfillFieldy` to the `useActionState` signature.
- Modify `components/lifelog-dashboard.tsx`: replace local-only filters/search/sync UI with URL-backed controls, a sidebar sync activity panel, conversation links, and cumulative load-more.
- Create `lib/lifelog/conversation-detail.ts`: authenticated-read mapping for one conversation, its transcript rows, and linked tasks.
- Create `app/conversations/[id]/page.tsx`: owner-authenticated detail route with UUID validation, `notFound()` on invalid/missing/RLS-invisible rows, and transcript UI.
- Modify `app/globals.css`: focused styles for sync panel, URL filters, conversation links, detail page, transcript rows, and empty states.
- Add/update tests in `tests/`: query helper tests, dashboard data query tests, source tests for page/UI/action contracts, sync mapper redaction tests, conversation detail mapper tests, and route source tests.

---

### Task 1: Dashboard Query Normalization And Search Filter Helpers

**Files:**
- Create: `lib/lifelog/dashboard-query.ts`
- Create: `tests/dashboard-query.test.ts`

- [ ] **Step 1: Write failing tests for dashboard query normalization**

Create `tests/dashboard-query.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DASHBOARD_MAX_PAGE,
  DASHBOARD_PAGE_SIZE,
  buildConversationSearchFilter,
  getDashboardRangeBounds,
  normalizeDashboardQuery,
} from "../lib/lifelog/dashboard-query.ts";

test("normalizeDashboardQuery defaults invalid params", () => {
  const query = normalizeDashboardQuery({
    q: ["  transcript  "],
    type: "invalid",
    range: "later",
    page: "-10",
  });

  assert.deepEqual(query, {
    q: "transcript",
    type: "all",
    range: "all",
    page: 1,
  });
});

test("normalizeDashboardQuery accepts known filters and caps page", () => {
  const query = normalizeDashboardQuery({
    q: "  fieldy ".repeat(80),
    type: "mention",
    range: "week",
    page: String(DASHBOARD_MAX_PAGE + 100),
  });

  assert.equal(query.q.length, 200);
  assert.equal(query.type, "mention");
  assert.equal(query.range, "week");
  assert.equal(query.page, DASHBOARD_MAX_PAGE);
});

test("dashboard constants define a bounded cumulative page size", () => {
  assert.equal(DASHBOARD_PAGE_SIZE, 25);
  assert.equal(DASHBOARD_MAX_PAGE, 20);
});
```

- [ ] **Step 2: Run the query tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-query.test.ts
```

Expected: FAIL with module-not-found for `../lib/lifelog/dashboard-query.ts`.

- [ ] **Step 3: Implement dashboard query normalization**

Create `lib/lifelog/dashboard-query.ts` with:

```ts
export const DASHBOARD_PAGE_SIZE = 25;
export const DASHBOARD_MAX_PAGE = 20;
export const DASHBOARD_MAX_SEARCH_LENGTH = 200;

export const DASHBOARD_CONVERSATION_FILTER_TYPES = [
  "all",
  "conversation",
  "note",
  "task",
  "mention",
] as const;

export const DASHBOARD_RANGE_FILTERS = ["all", "today", "week"] as const;

export type DashboardConversationFilterType =
  (typeof DASHBOARD_CONVERSATION_FILTER_TYPES)[number];

export type DashboardRangeFilter = (typeof DASHBOARD_RANGE_FILTERS)[number];

export type DashboardQuery = {
  q: string;
  type: DashboardConversationFilterType;
  range: DashboardRangeFilter;
  page: number;
};

type SearchParamsValue = string | string[] | undefined;

function readFirstParam(value: SearchParamsValue) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function isDashboardConversationFilterType(
  value: string,
): value is DashboardConversationFilterType {
  return DASHBOARD_CONVERSATION_FILTER_TYPES.includes(
    value as DashboardConversationFilterType,
  );
}

function isDashboardRangeFilter(value: string): value is DashboardRangeFilter {
  return DASHBOARD_RANGE_FILTERS.includes(value as DashboardRangeFilter);
}

function normalizeSearch(value: SearchParamsValue) {
  return readFirstParam(value).trim().slice(0, DASHBOARD_MAX_SEARCH_LENGTH);
}

function normalizePage(value: SearchParamsValue) {
  const page = Number(readFirstParam(value));
  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }
  return Math.min(page, DASHBOARD_MAX_PAGE);
}

export function normalizeDashboardQuery(
  params: Record<string, SearchParamsValue>,
): DashboardQuery {
  const rawType = readFirstParam(params.type);
  const rawRange = readFirstParam(params.range);

  return {
    q: normalizeSearch(params.q),
    type: isDashboardConversationFilterType(rawType) ? rawType : "all",
    range: isDashboardRangeFilter(rawRange) ? rawRange : "all",
    page: normalizePage(params.page),
  };
}
```

- [ ] **Step 4: Run normalization tests and verify current failures narrow**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-query.test.ts
```

Expected: FAIL because `buildConversationSearchFilter` and `getDashboardRangeBounds` are not exported yet.

- [ ] **Step 5: Add failing tests for search filter safety**

Append to `tests/dashboard-query.test.ts`:

```ts
test("buildConversationSearchFilter returns null for empty search", () => {
  assert.equal(buildConversationSearchFilter(""), null);
  assert.equal(buildConversationSearchFilter("   "), null);
});

test("buildConversationSearchFilter strips PostgREST grammar characters and LIKE wildcards", () => {
  const filter = buildConversationSearchFilter(
    String.raw`Meeting, owner.id:(abc)%_ * "quoted" \ path`,
  );

  assert.equal(
    filter,
    "title.ilike.*Meeting owner id abc quoted path*,summary.ilike.*Meeting owner id abc quoted path*,content.ilike.*Meeting owner id abc quoted path*",
  );
});

test("buildConversationSearchFilter returns null when input has only filter grammar", () => {
  assert.equal(buildConversationSearchFilter(String.raw`,.:()"\\%_*`), null);
});

test("buildConversationSearchFilter caps very long input", () => {
  const filter = buildConversationSearchFilter("a".repeat(250));
  const firstClause = filter?.split(",")[0] ?? "";

  assert.ok(firstClause.length < 230);
  assert.match(firstClause, /^title\.ilike\.\*a+\*$/);
});
```

- [ ] **Step 6: Run search tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-query.test.ts
```

Expected: FAIL with `buildConversationSearchFilter is not a function`.

- [ ] **Step 7: Implement the search filter helper**

Append to `lib/lifelog/dashboard-query.ts`:

```ts
const POSTGREST_FILTER_GRAMMAR_OR_WILDCARDS = /[\\,.:()"%_*]/g;

function normalizePostgrestIlikePattern(value: string) {
  return value
    .replace(POSTGREST_FILTER_GRAMMAR_OR_WILDCARDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildConversationSearchFilter(q: string) {
  const normalized = normalizePostgrestIlikePattern(q).slice(
    0,
    DASHBOARD_MAX_SEARCH_LENGTH,
  );
  if (!normalized) {
    return null;
  }

  const pattern = `*${normalized}*`;

  return [
    `title.ilike.${pattern}`,
    `summary.ilike.${pattern}`,
    `content.ilike.${pattern}`,
  ].join(",");
}
```

- [ ] **Step 8: Add failing tests for date range bounds**

Append to `tests/dashboard-query.test.ts`:

```ts
test("getDashboardRangeBounds returns null for all range", () => {
  assert.equal(
    getDashboardRangeBounds({
      range: "all",
      displayTimeZone: "America/Chicago",
      now: new Date("2026-06-17T15:30:00.000Z"),
    }),
    null,
  );
});

test("getDashboardRangeBounds calculates today in the display timezone", () => {
  assert.deepEqual(
    getDashboardRangeBounds({
      range: "today",
      displayTimeZone: "America/Chicago",
      now: new Date("2026-06-17T15:30:00.000Z"),
    }),
    {
      startedAtGte: "2026-06-17T05:00:00.000Z",
      startedAtLt: "2026-06-18T05:00:00.000Z",
    },
  );
});

test("getDashboardRangeBounds calculates rolling week ending at render time", () => {
  assert.deepEqual(
    getDashboardRangeBounds({
      range: "week",
      displayTimeZone: "America/Chicago",
      now: new Date("2026-06-17T15:30:00.000Z"),
    }),
    {
      startedAtGte: "2026-06-10T15:30:00.000Z",
      startedAtLt: "2026-06-17T15:30:00.001Z",
    },
  );
});
```

- [ ] **Step 9: Implement date range bounds**

Append to `lib/lifelog/dashboard-query.ts`:

```ts
function getDisplayDateParts(value: Date, displayTimeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: displayTimeZone,
    year: "numeric",
  }).formatToParts(value);

  return {
    day: Number(parts.find((part) => part.type === "day")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
}

function getDisplayDayStart(value: Date, displayTimeZone: string) {
  const { day, month, year } = getDisplayDateParts(value, displayTimeZone);
  const approximateUtcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: displayTimeZone,
    timeZoneName: "longOffset",
  }).formatToParts(approximateUtcNoon);
  const offset = offsetParts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) *
      (Number(match[2]) * 60 + Number(match[3]))
    : 0;

  return new Date(Date.UTC(year, month - 1, day) - offsetMinutes * 60_000);
}

export function getDashboardRangeBounds({
  range,
  displayTimeZone,
  now,
}: {
  range: DashboardRangeFilter;
  displayTimeZone: string;
  now: Date;
}) {
  if (range === "all") {
    return null;
  }

  if (range === "today") {
    const start = getDisplayDayStart(now, displayTimeZone);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    return {
      startedAtGte: start.toISOString(),
      startedAtLt: end.toISOString(),
    };
  }

  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 1);

  return {
    startedAtGte: start.toISOString(),
    startedAtLt: end.toISOString(),
  };
}
```

- [ ] **Step 10: Run query helper tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-query.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit dashboard query helpers**

Run:

```bash
git add lib/lifelog/dashboard-query.ts tests/dashboard-query.test.ts
git commit -m "Add dashboard query helpers"
```

Expected: commit succeeds.

---

### Task 2: Server-Backed Dashboard Data And Page Params

**Files:**
- Modify: `lib/lifelog/dashboard-data.ts`
- Modify: `app/page.tsx`
- Modify: `tests/dashboard-data.test.ts`
- Create: `tests/dashboard-page-source.test.ts`

- [ ] **Step 1: Add failing dashboard data query tests**

Append to `tests/dashboard-data.test.ts`:

```ts
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
```

- [ ] **Step 2: Add the recording test helper**

Insert this helper above the new test in `tests/dashboard-data.test.ts`:

```ts
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
```

- [ ] **Step 3: Run dashboard data tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-data.test.ts
```

Expected: FAIL because `getDashboardData` does not accept query options or return pagination metadata yet.

- [ ] **Step 4: Update dashboard data types and mapper**

Modify `lib/lifelog/dashboard-data.ts` imports and types:

```ts
import {
  DASHBOARD_PAGE_SIZE,
  buildConversationSearchFilter,
  getDashboardRangeBounds,
  type DashboardQuery,
} from "@/lib/lifelog/dashboard-query";
```

Extend `DashboardData`:

```ts
  query: DashboardQuery;
  totalConversationCount: number;
  shownConversationCount: number;
  hasMoreConversations: boolean;
```

Update `mapDashboardData` signature and return value:

```ts
export function mapDashboardData({
  conversations,
  tasks,
  syncRuns,
  openTaskCount,
  query = { q: "", type: "all", range: "all", page: 1 },
  totalConversationCount,
}: {
  conversations: DashboardConversationRow[];
  tasks: DashboardTaskRow[];
  syncRuns: DashboardSyncRunRow[];
  openTaskCount?: number;
  query?: DashboardQuery;
  totalConversationCount?: number | null;
}): DashboardData {
  const openStatuses = new Set<string>(OPEN_TASK_STATUSES);
  const mappedConversations = conversations.map((conversation) => ({
    id: conversation.id,
    fieldyId: conversation.fieldy_id,
    title: conversation.title ?? "Untitled conversation",
    summary: conversation.summary ?? "No summary available yet.",
    startedAt: conversation.started_at,
    endedAt: conversation.ended_at,
    keywords: conversation.keywords,
    type: mapFieldyConversationType(conversation.fieldy_metadata),
  }));
  const conversationCount = totalConversationCount ?? mappedConversations.length;

  return {
    conversations: mappedConversations,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.due_at,
      conversationId: task.conversation_id,
    })),
    openTaskCount:
      openTaskCount ?? tasks.filter((task) => openStatuses.has(task.status)).length,
    lastSync: syncRuns[0] ?? null,
    query,
    totalConversationCount: conversationCount,
    shownConversationCount: mappedConversations.length,
    hasMoreConversations: mappedConversations.length < conversationCount,
  };
}
```

- [ ] **Step 5: Implement dashboard query application**

Update `getDashboardData` in `lib/lifelog/dashboard-data.ts`:

```ts
export async function getDashboardData(
  supabase: SupabaseClient<Database>,
  options: {
    userId: string;
    query?: DashboardQuery;
    displayTimeZone?: string;
    now?: Date;
  } = {},
): Promise<DashboardData> {
  const query = options.query ?? { q: "", type: "all", range: "all", page: 1 };
  const now = options.now ?? new Date();
  const displayTimeZone = options.displayTimeZone ?? "America/Chicago";
  const rangeBounds = getDashboardRangeBounds({
    range: query.range,
    displayTimeZone,
    now,
  });

  let conversationsQuery = supabase
    .from("conversations")
    .select(
      "id, fieldy_id, title, summary, started_at, ended_at, keywords, fieldy_metadata",
      { count: "exact" },
    )
    .eq("user_id", options.userId);

  const searchFilter = buildConversationSearchFilter(query.q);
  if (searchFilter) {
    conversationsQuery = conversationsQuery.or(searchFilter);
  }

  if (query.type !== "all" && query.type !== "conversation") {
    conversationsQuery = conversationsQuery.filter("fieldy_metadata->>type", "eq", query.type);
  }

  if (query.type === "conversation") {
    conversationsQuery = conversationsQuery.or(
      "fieldy_metadata->>type.is.null,fieldy_metadata->>type.eq.conversation,fieldy_metadata->>type.not.in.(note,task,mention)",
    );
  }

  if (rangeBounds) {
    conversationsQuery = conversationsQuery
      .gte("started_at", rangeBounds.startedAtGte)
      .lt("started_at", rangeBounds.startedAtLt);
  }

  conversationsQuery = conversationsQuery
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(0, query.page * DASHBOARD_PAGE_SIZE - 1);

  const [conversationsResult, tasksResult, openTaskCountResult, syncRunsResult] =
    await Promise.all([
      conversationsQuery,
      supabase
        .from("tasks")
        .select("id, title, status, due_at, conversation_id")
        .eq("user_id", options.userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", options.userId)
        .in("status", [...OPEN_TASK_STATUSES]),
      supabase
        .from("sync_runs")
        .select(
          "id, source, status, started_at, finished_at, imported_count, error_message",
        )
        .eq("user_id", options.userId)
        .order("started_at", { ascending: false })
        .limit(1),
    ]);

  if (conversationsResult.error) throw conversationsResult.error;
  if (tasksResult.error) throw tasksResult.error;
  if (openTaskCountResult.error) throw openTaskCountResult.error;
  if (syncRunsResult.error) throw syncRunsResult.error;

  return mapDashboardData({
    conversations: conversationsResult.data ?? [],
    tasks: tasksResult.data ?? [],
    syncRuns: syncRunsResult.data ?? [],
    openTaskCount: openTaskCountResult.count ?? 0,
    query,
    totalConversationCount: conversationsResult.count ?? 0,
  });
}
```

- [ ] **Step 6: Run dashboard data tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-data.test.ts
```

Expected: PASS. If the existing `getDashboardData uses exact open task count` test fails because its fake builder lacks `.range()` or `.filter()`, update that fake builder with the same pass-through methods from Step 2.

- [ ] **Step 7: Add page source tests**

Create `tests/dashboard-page-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/page.tsx", "utf8");

test("dashboard page awaits Next 16 search params and normalizes dashboard query", () => {
  assert.match(source, /searchParams:\s*Promise<Record<string, string \| string\[\] \| undefined>>/);
  assert.match(source, /await searchParams/);
  assert.match(source, /normalizeDashboardQuery/);
});

test("dashboard page passes normalized query and display timezone to getDashboardData", () => {
  assert.match(source, /getDisplayTimeZone\(\)/);
  assert.match(source, /getDashboardData\(supabase,\s*\{/);
  assert.match(source, /query: dashboardQuery/);
  assert.match(source, /displayTimeZone/);
});
```

- [ ] **Step 8: Run page source tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-page-source.test.ts
```

Expected: FAIL because `app/page.tsx` does not use async `searchParams` yet.

- [ ] **Step 9: Update `app/page.tsx`**

Replace `app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { LifelogDashboard } from "@/components/lifelog-dashboard";
import { getDisplayTimeZone, getOwnerUserId } from "@/lib/env";
import { getDashboardData } from "@/lib/lifelog/dashboard-data";
import { normalizeDashboardQuery } from "@/lib/lifelog/dashboard-query";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  const displayTimeZone = getDisplayTimeZone();
  const renderedAt = new Date();
  const dashboardQuery = normalizeDashboardQuery(await searchParams);
  const dashboardData = await getDashboardData(supabase, {
    userId: user.id,
    query: dashboardQuery,
    displayTimeZone,
    now: renderedAt,
  });

  return (
    <LifelogDashboard
      data={dashboardData}
      displayTimeZone={displayTimeZone}
      renderedAt={renderedAt.toISOString()}
    />
  );
}
```

- [ ] **Step 10: Run dashboard query/page/data tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-query.test.ts tests/dashboard-data.test.ts tests/dashboard-page-source.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit server-backed dashboard data**

Run:

```bash
git add app/page.tsx lib/lifelog/dashboard-data.ts tests/dashboard-data.test.ts tests/dashboard-page-source.test.ts
git commit -m "Wire dashboard server query state"
```

Expected: commit succeeds.

---

### Task 3: Backfill Action State And Safe Sync Display Mapping

**Files:**
- Modify: `app/actions/backfill-fieldy.ts`
- Create: `lib/lifelog/backfill-action-state.ts`
- Modify: `lib/lifelog/dashboard-data.ts`
- Modify: `tests/backfill-action-source.test.ts`
- Modify: `tests/dashboard-data.test.ts`

- [ ] **Step 1: Add failing tests for action-state source contract**

Append to `tests/backfill-action-source.test.ts`:

```ts
const actionSource = readFileSync("app/actions/backfill-fieldy.ts", "utf8");
const stateSource = readFileSync("lib/lifelog/backfill-action-state.ts", "utf8");

test("backfill action exposes useActionState-compatible state", () => {
  assert.match(stateSource, /export type BackfillActionState/);
  assert.match(stateSource, /status: "idle" \| "success" \| "error"/);
  assert.match(stateSource, /export const initialBackfillActionState/);
  assert.match(actionSource, /backfillFieldy\(\s*_prevStateOrFormData: BackfillActionState \| FormData,\s*_formData\?: FormData/);
  assert.match(actionSource, /return \{\s*status: "success"/);
  assert.match(actionSource, /return \{\s*status: "error"/);
  assert.doesNotMatch(actionSource, /export const initialBackfillActionState/);
});
```

- [ ] **Step 2: Run action source tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/backfill-action-source.test.ts
```

Expected: FAIL because `BackfillActionState` is not defined.

- [ ] **Step 3: Create shared action-state module**

Create `lib/lifelog/backfill-action-state.ts`:

```ts
export type BackfillActionState = {
  status: "idle" | "success" | "error";
  message: string;
  importedCount: number | null;
};

export const initialBackfillActionState: BackfillActionState = {
  status: "idle",
  message: "",
  importedCount: null,
};
```

- [ ] **Step 4: Update `backfillFieldy` to return action state**

Replace `app/actions/backfill-fieldy.ts` with:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { getFieldyEnv, getOwnerUserId } from "@/lib/env";
import { createFieldyClient } from "@/lib/fieldy/client";
import { createIngestionService } from "@/lib/lifelog/ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BackfillActionState } from "@/lib/lifelog/backfill-action-state";
import { runFieldyBackfill } from "./backfill-fieldy-core";

export async function backfillFieldy(
  _prevStateOrFormData: BackfillActionState | FormData,
  _formData?: FormData,
): Promise<BackfillActionState> {
  const formData = _formData ?? _prevStateOrFormData;
  void formData;

  const result = await runFieldyBackfill({
    getOwnerUserId,
    getCurrentUser: async () => {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      return user;
    },
    getFieldyEnv: () => {
      const { fieldyApiKey, fieldyBackfillDays } = getFieldyEnv();
      return { fieldyApiKey, fieldyBackfillDays };
    },
    createSupabaseAdminClient,
    createFieldyClient,
    createIngestionService,
    revalidatePath,
  });

  if (result.ok) {
    return {
      status: "success",
      message: `Imported ${result.importedCount} Fieldy rows.`,
      importedCount: result.importedCount,
    };
  }

  return {
    status: "error",
    message: result.error,
    importedCount: null,
  };
}
```

- [ ] **Step 5: Run action tests**

Run:

```bash
node --test --experimental-strip-types tests/backfill-action-source.test.ts tests/backfill-action-behavior.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add failing tests for sync display redaction**

Update the import from `../lib/lifelog/dashboard-data.ts` in `tests/dashboard-data.test.ts` to include `mapSyncRunDisplay`, then append:

```ts
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
    ["00000000-0000-4000-8000-000000000001", "Sync failed. Check Fieldy configuration and try again."],
    ["fld_1234567890", "Sync failed. Check Fieldy configuration and try again."],
    ["Alice said call me back after the appointment transcript text", "Sync failed. Check Fieldy configuration and try again."],
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
```

- [ ] **Step 7: Run dashboard data tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-data.test.ts
```

Expected: FAIL because `lastSyncDisplay` does not exist.

- [ ] **Step 8: Implement sync display mapping**

In `lib/lifelog/dashboard-data.ts`, add:

```ts
export type DashboardSyncDisplay = {
  source: DashboardSyncRunRow["source"];
  status: DashboardSyncRunRow["status"];
  importedCount: number;
  finishedAt: string | null;
  displayError: string | null;
};

function toSafeSyncDisplayError(errorMessage: string | null) {
  if (!errorMessage) return null;

  const allowedMessages = new Set([
    "Fieldy backfill failed",
    "Fieldy webhook reconciliation failed",
    "No canonical Fieldy conversation matched webhook date",
    "No canonical Fieldy transcription matched webhook text",
    "Multiple canonical Fieldy conversations matched webhook text",
    "Invalid Fieldy webhook date",
  ]);

  if (allowedMessages.has(errorMessage) || /^Fieldy API request failed with \d+$/.test(errorMessage)) {
    return errorMessage;
  }

  return "Sync failed. Check Fieldy configuration and try again.";
}

export function mapSyncRunDisplay(
  syncRun: DashboardSyncRunRow | null,
): DashboardSyncDisplay | null {
  if (!syncRun) return null;

  return {
    source: syncRun.source,
    status: syncRun.status,
    importedCount: syncRun.imported_count,
    finishedAt: syncRun.finished_at,
    displayError: toSafeSyncDisplayError(syncRun.error_message),
  };
}
```

Extend `DashboardData`:

```ts
  lastSyncDisplay: DashboardSyncDisplay | null;
```

In `mapDashboardData`, set:

```ts
    lastSync: syncRuns[0] ?? null,
    lastSyncDisplay: mapSyncRunDisplay(syncRuns[0] ?? null),
```

- [ ] **Step 9: Run dashboard/action tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-data.test.ts tests/backfill-action-source.test.ts tests/backfill-action-behavior.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit sync action state and display mapper**

Run:

```bash
git add app/actions/backfill-fieldy.ts lib/lifelog/backfill-action-state.ts lib/lifelog/dashboard-data.ts tests/backfill-action-source.test.ts tests/dashboard-data.test.ts
git commit -m "Add sync action state and display mapping"
```

Expected: commit succeeds.

---

### Task 4: Conversation Detail Data Helper And Route

**Files:**
- Create: `lib/lifelog/conversation-detail.ts`
- Create: `app/conversations/[id]/page.tsx`
- Create: `tests/conversation-detail.test.ts`
- Create: `tests/conversation-detail-route-source.test.ts`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing mapper tests**

Create `tests/conversation-detail.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getConversationDetail,
  isUuid,
  mapConversationDetail,
} from "../lib/lifelog/conversation-detail.ts";

test("isUuid accepts canonical UUIDs only", () => {
  assert.equal(isUuid("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("00000000-0000-4000-8000-000000000001/sneaky"), false);
});

test("mapConversationDetail orders transcript rows and maps linked tasks", () => {
  const detail = mapConversationDetail({
    conversation: {
      id: "conversation-1",
      fieldy_id: "fieldy-1",
      title: null,
      summary: null,
      content: "Full content",
      started_at: "2026-06-16T10:00:00.000Z",
      ended_at: "2026-06-16T10:30:00.000Z",
      keywords: ["planning"],
      fieldy_metadata: { type: "conversation" },
    },
    transcriptions: [
      {
        id: "segment-2",
        speaker_label: null,
        text: "Second",
        started_at: "2026-06-16T10:05:00.000Z",
        ended_at: null,
      },
      {
        id: "segment-1",
        speaker_label: "Jamie",
        text: "First",
        started_at: "2026-06-16T10:01:00.000Z",
        ended_at: null,
      },
    ],
    tasks: [
      {
        id: "task-1",
        title: "Send recap",
        status: "new",
        due_at: null,
      },
    ],
  });

  assert.equal(detail.title, "Untitled conversation");
  assert.deepEqual(
    detail.transcript.map((segment) => segment.text),
    ["First", "Second"],
  );
  assert.equal(detail.tasks[0]?.title, "Send recap");
});

test("getConversationDetail returns null without child queries when conversation is missing", async () => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = createConversationDetailClient({
    calls,
    conversationResult: { data: null, error: null },
  });

  assert.equal(
    await getConversationDetail(
      client as never,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
    ),
    null,
  );
  assert.deepEqual(calls.map((call) => call.table), ["conversations", "conversations", "conversations"]);
});

test("getConversationDetail filters all reads by authorized user and conversation id", async () => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = createConversationDetailClient({
    calls,
    conversationResult: {
      data: {
        id: "conversation-1",
        fieldy_id: "fieldy-1",
        title: "Planning",
        summary: "Summary",
        content: null,
        started_at: null,
        ended_at: null,
        keywords: [],
        fieldy_metadata: {},
      },
      error: null,
    },
    transcriptionsResult: { data: [], error: null },
    tasksResult: { data: [], error: null },
  });

  await getConversationDetail(
    client as never,
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000001",
  );

  assert.deepEqual(
    calls.map((call) => [call.table, call.method, call.args]),
    [
      ["conversations", "select", ["id, fieldy_id, title, summary, content, started_at, ended_at, keywords, fieldy_metadata"]],
      ["conversations", "eq", ["id", "00000000-0000-4000-8000-000000000001"]],
      ["conversations", "eq", ["user_id", "00000000-0000-4000-8000-000000000001"]],
      ["transcriptions", "select", ["id, speaker_label, text, started_at, ended_at"]],
      ["transcriptions", "eq", ["conversation_id", "conversation-1"]],
      ["transcriptions", "eq", ["user_id", "00000000-0000-4000-8000-000000000001"]],
      ["transcriptions", "order", ["started_at", { ascending: true, nullsFirst: false }]],
      ["transcriptions", "order", ["id", { ascending: true }]],
      ["tasks", "select", ["id, title, status, due_at"]],
      ["tasks", "eq", ["conversation_id", "conversation-1"]],
      ["tasks", "eq", ["user_id", "00000000-0000-4000-8000-000000000001"]],
      ["tasks", "order", ["created_at", { ascending: false }]],
    ],
  );
});
```

- [ ] **Step 2: Run mapper tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/conversation-detail.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Add the recording Supabase fake for detail tests**

Append this helper to `tests/conversation-detail.test.ts`:

```ts
function createConversationDetailClient({
  calls,
  conversationResult,
  transcriptionsResult = { data: [], error: null },
  tasksResult = { data: [], error: null },
}: {
  calls: Array<{ table: string; method: string; args: unknown[] }>;
  conversationResult: { data: unknown; error: unknown };
  transcriptionsResult?: { data: unknown; error: unknown };
  tasksResult?: { data: unknown; error: unknown };
}) {
  const responses = {
    conversations: conversationResult,
    transcriptions: transcriptionsResult,
    tasks: tasksResult,
  };

  return {
    from(table: "conversations" | "transcriptions" | "tasks") {
      const builder = {
        select(...args: unknown[]) {
          calls.push({ table, method: "select", args });
          return builder;
        },
        eq(...args: unknown[]) {
          calls.push({ table, method: "eq", args });
          return builder;
        },
        order(...args: unknown[]) {
          calls.push({ table, method: "order", args });
          return builder;
        },
        async maybeSingle() {
          return responses[table];
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(responses[table]).then(resolve, reject);
        },
      };

      return builder;
    },
  };
}
```

- [ ] **Step 4: Implement conversation detail mapper and query helper**

Create `lib/lifelog/conversation-detail.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DashboardConversationType } from "@/lib/lifelog/dashboard-data";
import type { Database, Json } from "@/lib/supabase/types";

type ConversationRow = Pick<
  Database["public"]["Tables"]["conversations"]["Row"],
  | "id"
  | "fieldy_id"
  | "title"
  | "summary"
  | "content"
  | "started_at"
  | "ended_at"
  | "keywords"
  | "fieldy_metadata"
>;

type TranscriptionRow = Pick<
  Database["public"]["Tables"]["transcriptions"]["Row"],
  "id" | "speaker_label" | "text" | "started_at" | "ended_at"
>;

type TaskRow = Pick<
  Database["public"]["Tables"]["tasks"]["Row"],
  "id" | "title" | "status" | "due_at"
>;

const DETAIL_CONVERSATION_TYPES = [
  "conversation",
  "note",
  "task",
  "mention",
] as const;

export type ConversationDetail = {
  id: string;
  fieldyId: string;
  title: string;
  summary: string;
  content: string | null;
  startedAt: string | null;
  endedAt: string | null;
  keywords: string[];
  type: DashboardConversationType;
  transcript: Array<{
    id: string;
    speakerLabel: string | null;
    text: string;
    startedAt: string | null;
    endedAt: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueAt: string | null;
  }>;
};

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function mapFieldyType(fieldyMetadata: Json): DashboardConversationType {
  if (!fieldyMetadata || Array.isArray(fieldyMetadata) || typeof fieldyMetadata !== "object") {
    return "conversation";
  }

  const type = fieldyMetadata.type;
  return typeof type === "string" &&
    DETAIL_CONVERSATION_TYPES.includes(type as DashboardConversationType)
    ? (type as DashboardConversationType)
    : "conversation";
}

export function mapConversationDetail({
  conversation,
  transcriptions,
  tasks,
}: {
  conversation: ConversationRow;
  transcriptions: TranscriptionRow[];
  tasks: TaskRow[];
}): ConversationDetail {
  const transcript = [...transcriptions]
    .sort((first, second) => {
      const firstTime = first.started_at ? new Date(first.started_at).getTime() : Number.MAX_SAFE_INTEGER;
      const secondTime = second.started_at ? new Date(second.started_at).getTime() : Number.MAX_SAFE_INTEGER;
      return firstTime - secondTime || first.id.localeCompare(second.id);
    })
    .map((segment) => ({
      id: segment.id,
      speakerLabel: segment.speaker_label,
      text: segment.text,
      startedAt: segment.started_at,
      endedAt: segment.ended_at,
    }));

  return {
    id: conversation.id,
    fieldyId: conversation.fieldy_id,
    title: conversation.title ?? "Untitled conversation",
    summary: conversation.summary ?? "No summary available yet.",
    content: conversation.content,
    startedAt: conversation.started_at,
    endedAt: conversation.ended_at,
    keywords: conversation.keywords,
    type: mapFieldyType(conversation.fieldy_metadata),
    transcript,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.due_at,
    })),
  };
}

export async function getConversationDetail(
  supabase: SupabaseClient<Database>,
  id: string,
  userId: string,
) {
  const conversationResult = await supabase
    .from("conversations")
    .select(
      "id, fieldy_id, title, summary, content, started_at, ended_at, keywords, fieldy_metadata",
    )
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (conversationResult.error) {
    throw conversationResult.error;
  }

  if (!conversationResult.data) {
    return null;
  }

  const [transcriptionsResult, tasksResult] = await Promise.all([
    supabase
      .from("transcriptions")
      .select("id, speaker_label, text, started_at, ended_at")
      .eq("conversation_id", conversationResult.data.id)
      .eq("user_id", userId)
      .order("started_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
    supabase
      .from("tasks")
      .select("id, title, status, due_at")
      .eq("conversation_id", conversationResult.data.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (transcriptionsResult.error) {
    throw transcriptionsResult.error;
  }

  if (tasksResult.error) {
    throw tasksResult.error;
  }

  return mapConversationDetail({
    conversation: conversationResult.data,
    transcriptions: transcriptionsResult.data ?? [],
    tasks: tasksResult.data ?? [],
  });
}
```

- [ ] **Step 5: Run mapper tests**

Run:

```bash
node --test --experimental-strip-types tests/conversation-detail.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add failing route source tests**

Create `tests/conversation-detail-route-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/conversations/[id]/page.tsx", "utf8");

test("conversation detail route uses async params and authenticated reads", () => {
  assert.match(source, /params:\s*Promise<\{ id: string \}>/);
  assert.match(source, /searchParams:\s*Promise<Record<string, string \| string\[\] \| undefined>>/);
  assert.match(source, /await params/);
  assert.match(source, /await searchParams/);
  assert.match(source, /createSupabaseServerClient/);
  assert.doesNotMatch(source, /createSupabaseAdminClient/);
});

test("conversation detail route validates UUIDs and uses notFound for misses", () => {
  assert.match(source, /isUuid/);
  assert.match(source, /readFirstSearchParam/);
  assert.match(source, /notFound\(\)/);
  assert.match(source, /getConversationDetail/);
});
```

- [ ] **Step 7: Run route source tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/conversation-detail-route-source.test.ts
```

Expected: FAIL because the detail route does not exist.

- [ ] **Step 8: Implement conversation detail route**

Create `app/conversations/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDisplayTimeZone, getOwnerUserId } from "@/lib/env";
import {
  getConversationDetail,
  isUuid,
  type ConversationDetail,
} from "@/lib/lifelog/conversation-detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function formatDateTime(value: string | null, displayTimeZone: string) {
  if (!value) return "No time";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: displayTimeZone,
  }).format(new Date(value));
}

function formatDuration(detail: ConversationDetail) {
  if (!detail.startedAt || !detail.endedAt) return "Pending";

  const durationMs = new Date(detail.endedAt).getTime() - new Date(detail.startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "Pending";

  const minutes = Math.round(durationMs / 60_000);
  return `${minutes} min`;
}

function readFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function buildBackHref(params: Record<string, string | string[] | undefined>) {
  const from = readFirstSearchParam(params.from);
  if (!from.startsWith("?")) return "/";

  const incoming = new URLSearchParams(from);
  const outgoing = new URLSearchParams();
  for (const key of ["q", "type", "range", "page"]) {
    const value = incoming.get(key);
    if (value) {
      outgoing.set(key, value);
    }
  }

  const query = outgoing.toString();
  return query ? `/?${query}` : "/";
}

export default async function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const detailSearchParams = await searchParams;

  if (!isUuid(id)) {
    notFound();
  }

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

  const detail = await getConversationDetail(supabase, id, user.id);
  if (!detail) {
    notFound();
  }

  const displayTimeZone = getDisplayTimeZone();

  return (
    <main className="detail-shell">
      <div className="detail-topbar">
        <Link href={buildBackHref(detailSearchParams)} className="detail-back-link">
          Back to timeline
        </Link>
      </div>

      <article className="detail-layout">
        <header className="detail-header">
          <p>{detail.type}</p>
          <h1>{detail.title}</h1>
          <div className="detail-meta">
            <span>{formatDateTime(detail.startedAt, displayTimeZone)}</span>
            <span>{formatDuration(detail)}</span>
          </div>
        </header>

        <section className="detail-section">
          <h2>Summary</h2>
          <p>{detail.summary}</p>
        </section>

        <section className="detail-section">
          <h2>Keywords</h2>
          {detail.keywords.length > 0 ? (
            <div className="detail-keywords">
              {detail.keywords.map((keyword) => (
                <span key={keyword}>{keyword}</span>
              ))}
            </div>
          ) : (
            <p>No keywords stored.</p>
          )}
        </section>

        <section className="detail-section">
          <h2>Transcript</h2>
          {detail.transcript.length > 0 ? (
            <div className="transcript-list">
              {detail.transcript.map((segment) => (
                <article className="transcript-row" key={segment.id}>
                  <time>{formatDateTime(segment.startedAt, displayTimeZone)}</time>
                  <div>
                    <strong>{segment.speakerLabel ?? "Speaker"}</strong>
                    <p>{segment.text}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p>No transcript segments are stored for this conversation yet.</p>
          )}
        </section>

        <section className="detail-section">
          <h2>Action items</h2>
          {detail.tasks.length > 0 ? (
            <div className="detail-task-list">
              {detail.tasks.map((task) => (
                <article key={task.id}>
                  <strong>{task.title}</strong>
                  <span>{task.status}</span>
                  <em>{task.dueAt ? formatDateTime(task.dueAt, displayTimeZone) : "No due date"}</em>
                </article>
              ))}
            </div>
          ) : (
            <p>No linked action items.</p>
          )}
        </section>
      </article>
    </main>
  );
}
```

- [ ] **Step 9: Add detail page styles**

Append to `app/globals.css`:

```css
.detail-shell {
  min-height: 100vh;
  background: var(--background);
}

.detail-topbar {
  display: flex;
  align-items: center;
  min-height: 68px;
  padding: 0 28px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.detail-back-link {
  color: var(--green);
  font-weight: 720;
  text-decoration: none;
}

.detail-layout {
  display: grid;
  gap: 22px;
  width: min(980px, calc(100vw - 36px));
  margin: 28px auto 56px;
}

.detail-header,
.detail-section {
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.detail-header p,
.detail-section h2 {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 13px;
  text-transform: capitalize;
}

.detail-header h1 {
  margin: 0;
  font-size: 34px;
  letter-spacing: 0;
}

.detail-meta,
.detail-keywords,
.detail-task-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.detail-meta span,
.detail-keywords span,
.detail-task-list article {
  padding: 7px 10px;
  border-radius: 7px;
  background: var(--surface-muted);
  color: var(--muted);
  font-size: 13px;
}

.transcript-list {
  display: grid;
  gap: 14px;
}

.transcript-row {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 18px;
  padding: 16px 0;
  border-top: 1px solid var(--border);
}

.transcript-row time {
  color: var(--muted);
  font-size: 13px;
}

.transcript-row p {
  margin: 6px 0 0;
  color: #26322f;
  line-height: 1.6;
}
```

- [ ] **Step 10: Run detail tests**

Run:

```bash
node --test --experimental-strip-types tests/conversation-detail.test.ts tests/conversation-detail-route-source.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit detail route**

Run:

```bash
git add app/conversations/[id]/page.tsx app/globals.css lib/lifelog/conversation-detail.ts tests/conversation-detail.test.ts tests/conversation-detail-route-source.test.ts
git commit -m "Add conversation detail route"
```

Expected: commit succeeds.

---

### Task 5: Functional Dashboard UI Controls

**Files:**
- Modify: `components/lifelog-dashboard.tsx`
- Modify: `app/globals.css`
- Modify: `tests/dashboard-ui-source.test.ts`

- [ ] **Step 1: Add failing source tests for URL-backed UI**

Append to `tests/dashboard-ui-source.test.ts`:

```ts
test("dashboard uses URL-backed search and filter controls", () => {
  assert.match(source, /useRouter/);
  assert.match(source, /usePathname/);
  assert.match(source, /URLSearchParams/);
  assert.match(source, /name="q"/);
  assert.match(source, /data\.query\.q/);
  assert.match(source, /type=conversation/);
  assert.doesNotMatch(source, /useState<ConversationFilterTab>\("All"\)/);
});

test("dashboard renders sync activity panel with action state", () => {
  assert.match(source, /useActionState/);
  assert.match(source, /initialBackfillActionState/);
  assert.match(source, /lastSyncDisplay/);
  assert.match(source, /sync-activity-panel/);
});

test("dashboard links conversations and preserves from query", () => {
  assert.match(source, /href=\{conversation\.href\}/);
  assert.match(source, /\/conversations\/\$\{conversation\.id\}/);
  assert.match(source, /from/);
});
```

- [ ] **Step 2: Run dashboard source tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-ui-source.test.ts
```

Expected: FAIL because dashboard UI is still local-only.

- [ ] **Step 3: Update dashboard imports and props**

In `components/lifelog-dashboard.tsx`, update imports:

```tsx
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useActionState, useMemo, useState, useTransition } from "react";
import {
  backfillFieldy,
} from "@/app/actions/backfill-fieldy";
import { initialBackfillActionState } from "@/lib/lifelog/backfill-action-state";
import type { DashboardConversationFilterType } from "@/lib/lifelog/dashboard-query";
```

Remove `filterConversationsByTab` and `ConversationFilterTab` imports. Keep `ConversationFilterType`.

Also prune removed lucide icons while updating this file. Remove `BatteryFull`, `Command`, and `MoreVertical` from the lucide import list when the device card, keyboard hint, and row action menu are removed.

- [ ] **Step 4: Replace tab constants with URL values**

Replace the `tabs` constant with:

```tsx
const tabs: Array<{
  label: string;
  value: DashboardConversationFilterType;
}> = [
  { label: "All", value: "all" },
  { label: "Conversations", value: "conversation" },
  { label: "Notes", value: "note" },
  { label: "Tasks", value: "task" },
  { label: "Mentions", value: "mention" },
];

const ranges = [
  { label: "All time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Week", value: "week" },
] as const;
```

- [ ] **Step 5: Add URL helper functions**

Inside `LifelogDashboard`, before `return`, add:

```tsx
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, startTransition] = useTransition();
  const [backfillState, backfillAction, isSyncPending] = useActionState(
    backfillFieldy,
    initialBackfillActionState,
  );

  function buildQueryString(updates: Record<string, string | null>) {
    const params = new URLSearchParams();
    if (data.query.q) params.set("q", data.query.q);
    if (data.query.type !== "all") params.set("type", data.query.type);
    if (data.query.range !== "all") params.set("range", data.query.range);
    if (data.query.page > 1) params.set("page", String(data.query.page));

    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "all" || (key === "page" && value === "1")) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
  }

  function navigateWith(updates: Record<string, string | null>) {
    startTransition(() => {
      router.push(`${pathname}${buildQueryString(updates)}`);
    });
  }

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const q = String(formData.get("q") ?? "").trim();
    navigateWith({ q: q || null, page: "1" });
  }

  const currentFromQuery = buildQueryString({});
```

- [ ] **Step 6: Update conversation view model**

In the `conversations` useMemo object, add `href`:

```tsx
      href: `/conversations/${conversation.id}${
        currentFromQuery
          ? `?from=${encodeURIComponent(currentFromQuery)}`
          : ""
      }`,
```

Add `href: string;` to the `Conversation` type.

- [ ] **Step 7: Remove local tab filtering**

Delete:

```tsx
  const [activeTab, setActiveTab] = useState<ConversationFilterTab>("All");
```

Replace visible conversation logic:

```tsx
  const visibleConversations = conversations;
  const hasImportedConversations = data.totalConversationCount > 0;
  const hasFilteredConversations = visibleConversations.length > 0;
```

- [ ] **Step 8: Replace sidebar device/sync controls with sync activity panel**

Replace the `device-card` section and standalone backfill form with:

```tsx
        <section className="sync-activity-panel" aria-label="Fieldy sync activity">
          <div>
            <p>Fieldy Sync</p>
            <strong className={syncStatusClassName}>
              <SyncStatusIcon aria-hidden="true" size={18} />
              {data.lastSyncDisplay?.status ?? "Not synced"}
            </strong>
          </div>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{data.lastSyncDisplay?.source ?? "None"}</dd>
            </div>
            <div>
              <dt>Imported</dt>
              <dd>{data.lastSyncDisplay?.importedCount ?? 0}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>
                {data.lastSyncDisplay?.finishedAt
                  ? formatDate(new Date(data.lastSyncDisplay.finishedAt), displayTimeZone)
                  : "Never"}
              </dd>
            </div>
          </dl>
          {data.lastSyncDisplay?.displayError ? (
            <p className="sync-error">{data.lastSyncDisplay.displayError}</p>
          ) : null}
          {backfillState.message ? (
            <p className={`sync-action-message sync-action-${backfillState.status}`}>
              {backfillState.message}
            </p>
          ) : null}
          <form action={backfillAction}>
            <button className="sync-button" disabled={isSyncPending} type="submit">
              <RefreshCcw aria-hidden="true" size={18} />
              {isSyncPending ? "Syncing..." : "Sync Fieldy"}
            </button>
          </form>
        </section>
```

- [ ] **Step 9: Replace topbar search/date controls**

Replace the topbar search label and date button with:

```tsx
          <form className="search-command" onSubmit={handleSearchSubmit}>
            <Search aria-hidden="true" size={20} />
            <input
              aria-label="Search conversations"
              defaultValue={data.query.q}
              name="q"
              placeholder="Search conversations, topics, tasks..."
              type="search"
            />
            <button disabled={isNavigating} type="submit">
              Search
            </button>
          </form>
          <div className="range-control" aria-label="Date range">
            {ranges.map((range) => (
              <button
                aria-pressed={data.query.range === range.value}
                className={data.query.range === range.value ? "is-active" : ""}
                key={range.value}
                onClick={() => navigateWith({ range: range.value, page: "1" })}
                type="button"
              >
                {range.label}
              </button>
            ))}
          </div>
```

- [ ] **Step 10: Replace tab buttons with URL navigation**

In timeline toolbar tab map, replace each button with:

```tsx
                    <button
                      aria-pressed={data.query.type === tab.value}
                      className={data.query.type === tab.value ? "tab is-active" : "tab"}
                      key={tab.value}
                      onClick={() => navigateWith({ type: tab.value, page: "1" })}
                      type="button"
                    >
                      {tab.label}
                    </button>
```

Remove the old range button from the toolbar.

- [ ] **Step 11: Update empty states and footer**

Replace filtered empty copy:

```tsx
                  <h2>No matching conversations</h2>
                  <p>Clear the search or choose another filter.</p>
                  <button onClick={() => navigateWith({ q: null, type: "all", range: "all", page: "1" })} type="button">
                    Clear filters
                  </button>
```

Replace footer with:

```tsx
              <footer className="timeline-footer">
                <span>
                  Showing {data.shownConversationCount} of {data.totalConversationCount} conversations
                </span>
                {data.hasMoreConversations ? (
                  <button
                    onClick={() => navigateWith({ page: String(data.query.page + 1) })}
                    type="button"
                  >
                    Load more <ChevronDown aria-hidden="true" size={15} />
                  </button>
                ) : null}
              </footer>
```

- [ ] **Step 12: Convert conversation rows to links**

In `TimelineGroup`, wrap the row content in `Link`:

```tsx
          <article className="conversation-row" key={conversation.id}>
            <Link className="conversation-link" href={conversation.href}>
              <div className="conversation-time">
                <span aria-hidden="true" />
                <time>{conversation.time}</time>
              </div>
              <div className={`conversation-icon type-${conversation.type}`}>
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              </div>
              <div className="conversation-copy">
                <h3>{conversation.title}</h3>
                <p>{conversation.people}</p>
                <small>{conversation.summary}</small>
              </div>
              {conversation.tasks > 0 ? (
                <span className="task-count">{conversation.tasks} tasks</span>
              ) : (
                <span className="task-count is-empty">No tasks</span>
              )}
              <span className="duration">
                <Clock3 aria-hidden="true" size={15} />
                {conversation.duration}
              </span>
            </Link>
          </article>
```

Remove the old `MoreVertical` button if no action menu is implemented.

- [ ] **Step 13: Add dashboard UI styles**

Append to `app/globals.css`:

```css
.sync-activity-panel {
  display: grid;
  gap: 12px;
  margin-top: auto;
  padding: 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.sync-activity-panel p,
.sync-activity-panel dl,
.sync-activity-panel dd {
  margin: 0;
}

.sync-activity-panel dl {
  display: grid;
  gap: 7px;
}

.sync-activity-panel div,
.sync-activity-panel dl div {
  display: grid;
  gap: 3px;
}

.sync-activity-panel dt {
  color: var(--muted);
  font-size: 12px;
}

.sync-activity-panel dd {
  color: var(--ink);
  font-size: 13px;
  font-weight: 650;
}

.sync-error,
.sync-action-error {
  color: #8a1f38;
}

.sync-action-success {
  color: var(--green);
}

.range-control {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.range-control button,
.search-command button {
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-weight: 650;
}

.range-control button.is-active,
.search-command button {
  color: var(--green);
  background: var(--surface-muted);
}

.conversation-link {
  display: contents;
  color: inherit;
  text-decoration: none;
}
```

- [ ] **Step 14: Run dashboard UI source tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-ui-source.test.ts
```

Expected: PASS.

- [ ] **Step 15: Run lint for the dashboard UI task**

Run:

```bash
npm run lint
```

Expected: PASS. If lint reports unused imports in `components/lifelog-dashboard.tsx`, remove those imports before committing.

- [ ] **Step 16: Commit dashboard UI controls**

Run:

```bash
git add app/globals.css components/lifelog-dashboard.tsx tests/dashboard-ui-source.test.ts
git commit -m "Wire functional dashboard controls"
```

Expected: commit succeeds.

---

### Task 6: Verification And Context7-Backed Review

**Files:**
- No planned file edits unless verification finds an issue.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Start the local app for manual inspection**

Run:

```bash
npm run dev
```

Expected: dev server starts and prints a local URL, usually `http://localhost:3000`.

- [ ] **Step 5: Manually inspect the UI**

In the browser:

1. Visit `/login` and sign in as the configured owner.
2. Confirm `/` renders the sync activity panel.
3. Submit a search and confirm the URL includes `q=...`.
4. Click a type tab and confirm the URL includes `type=...`.
5. Click a range control and confirm the URL includes `range=...`.
6. Click a conversation row and confirm `/conversations/[id]` renders.
7. Confirm the detail route shows summary, transcript, keywords, and tasks or explicit empty states.
8. Click back to timeline and confirm the previous query state is preserved.

- [ ] **Step 6: Dispatch required Context7-backed code review subagent**

Use a fresh subagent with this prompt:

```text
Review the completed end-to-end UI slice in /Users/jonmossie/Documents/GitHub/lifelog. Use Context7 docs for Next.js and Supabase before reviewing. Focus on: Next 16 async params/searchParams, useActionState server-action contract, Supabase PostgREST .or()/ilike search safety, .range() pagination/count behavior, RLS-safe detail route reads, sync display redaction, and whether tests cover the implementation. Do not edit files. Return findings ordered by severity with exact file/line references.
```

Expected: subagent returns either no blockers or actionable findings.

- [ ] **Step 7: Address review findings if any**

If the review returns findings, make a focused patch and rerun:

```bash
npm test
npm run lint
npm run build
```

Expected: PASS after any patch.

- [ ] **Step 8: Final commit if verification patches were needed**

If Step 7 changed files, run:

```bash
git add .
git commit -m "Fix UI slice review findings"
```

Expected: commit succeeds. If Step 7 made no changes, skip this commit.
