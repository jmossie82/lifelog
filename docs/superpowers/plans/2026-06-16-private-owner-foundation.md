# Private Owner Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private-owner Supabase foundation that auth-gates the Fieldy Lifelog app, persists canonical Fieldy REST data, reconciles Fieldy webhooks, supports a manual backfill, and renders persisted dashboard data.

**Architecture:** Supabase Auth protects the dashboard with one configured owner user. Server Components read through per-request Supabase SSR clients so RLS applies, while ingestion code uses a separate server-only admin client that never carries request cookies or user headers. Fieldy webhook events are treated as transcription-completed reconciliation triggers, and both webhook and manual backfill write canonical REST records through one idempotent ingestion module.

**Tech Stack:** Next.js App Router 16, React 19, TypeScript strict mode, Supabase SSR/Auth/Postgres/RLS, `@supabase/supabase-js`, Node test runner with `--experimental-strip-types`, Fieldy Public API.

---

## File Structure

- Create `supabase/migrations/20260616000000_private_owner_foundation.sql`: database tables, constraints, indexes, RLS policies, and updated-at trigger.
- Create `lib/env.ts`: server/client environment readers with safe non-secret error messages.
- Create `lib/supabase/types.ts`: minimal generated-style database types used by Supabase clients.
- Create `lib/supabase/server.ts`: per-request Supabase SSR client using `cookies().getAll()`.
- Create `lib/supabase/admin.ts`: server-only service/secret-key Supabase client with no cookies or forwarded authorization headers.
- Create `lib/supabase/proxy.ts`: session refresh helper with `cookies.getAll()` and `cookies.setAll()`.
- Create `proxy.ts`: Next.js request proxy that refreshes Supabase sessions.
- Create `app/login/page.tsx`: small email/password login form.
- Create `app/auth/actions.ts`: sign-in and sign-out Server Actions using Supabase Auth.
- Modify `lib/fieldy/types.ts`: replace early scaffold payload types with documented Fieldy REST and webhook types.
- Modify `lib/fieldy/webhook-validation.ts`: validate documented transcription-completed webhook payloads.
- Create `lib/fieldy/client.ts`: Fieldy REST client with cursor pagination and `429` retry behavior.
- Create `lib/lifelog/idempotency.ts`: stable hash helpers for derived transcript/task IDs.
- Create `lib/lifelog/ingestion.ts`: canonical normalization and idempotent admin-client upserts.
- Create `app/api/webhooks/fieldy/route.ts`: token-gated webhook route that reconciles nearby canonical Fieldy REST records.
- Create `app/actions/backfill-fieldy.ts`: owner-only manual backfill Server Action.
- Create `lib/lifelog/dashboard-data.ts`: owner-scoped dashboard query helpers.
- Modify `app/page.tsx`: auth-gate home page and pass persisted data to the dashboard component.
- Modify `components/lifelog-dashboard.tsx`: accept server data, show empty/sync/error states, and expose manual sync form.
- Modify `README.md`: document env vars, Supabase migration, owner setup, webhook URL, and verification commands.
- Add/modify tests under `tests/`: validation, Fieldy client, idempotency, ingestion, webhook route, backfill auth, and dashboard data mapping.

## Task 1: Dependencies and Environment Helpers

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/env.ts`
- Test: `tests/env.test.ts`

- [ ] **Step 1: Install Supabase dependencies**

Run:

```bash
npm install @supabase/ssr @supabase/supabase-js
```

Expected: `package.json` and `package-lock.json` include `@supabase/ssr` and `@supabase/supabase-js`.

- [ ] **Step 2: Write the failing environment helper tests**

Create `tests/env.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  getClientEnv,
  getFieldyEnv,
  getOwnerUserId,
  getSupabaseAdminEnv,
} from "../lib/env.ts";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

test("getClientEnv returns public Supabase settings", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

  assert.deepEqual(getClientEnv(), {
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
  });
});

test("getClientEnv throws a non-secret message for missing public env", () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

  assert.throws(
    () => getClientEnv(),
    /Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL/,
  );
});

test("getSupabaseAdminEnv returns server-only Supabase admin settings", () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

  assert.deepEqual(getSupabaseAdminEnv(), {
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-key",
  });
});

test("getFieldyEnv returns Fieldy settings with a 30 day default", () => {
  process.env.FIELDY_API_KEY = "sk-fieldy-example";
  process.env.FIELDY_WEBHOOK_SECRET = "secret";
  delete process.env.FIELDY_BACKFILL_DAYS;

  assert.deepEqual(getFieldyEnv(), {
    fieldyApiKey: "sk-fieldy-example",
    fieldyWebhookSecret: "secret",
    fieldyBackfillDays: 30,
  });
});

test("getFieldyEnv accepts a positive FIELDY_BACKFILL_DAYS value", () => {
  process.env.FIELDY_API_KEY = "sk-fieldy-example";
  process.env.FIELDY_WEBHOOK_SECRET = "secret";
  process.env.FIELDY_BACKFILL_DAYS = "14";

  assert.equal(getFieldyEnv().fieldyBackfillDays, 14);
});

test("getFieldyEnv rejects invalid FIELDY_BACKFILL_DAYS", () => {
  process.env.FIELDY_API_KEY = "sk-fieldy-example";
  process.env.FIELDY_WEBHOOK_SECRET = "secret";
  process.env.FIELDY_BACKFILL_DAYS = "0";

  assert.throws(
    () => getFieldyEnv(),
    /FIELDY_BACKFILL_DAYS must be a positive integer/,
  );
});

test("getOwnerUserId returns the configured owner user id", () => {
  process.env.LIFELOG_OWNER_USER_ID = "00000000-0000-4000-8000-000000000001";

  assert.equal(getOwnerUserId(), "00000000-0000-4000-8000-000000000001");
});
```

- [ ] **Step 3: Run the environment tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/env.test.ts
```

Expected: FAIL with module-not-found or missing export errors for `../lib/env.ts`.

- [ ] **Step 4: Implement `lib/env.ts`**

Create `lib/env.ts`:

```ts
function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getClientEnv() {
  return {
    supabaseUrl: readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

export function getSupabaseAdminEnv() {
  return {
    supabaseUrl: readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceRoleKey: readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getFieldyEnv() {
  const configuredDays = process.env.FIELDY_BACKFILL_DAYS ?? "30";
  const fieldyBackfillDays = Number.parseInt(configuredDays, 10);

  if (!Number.isInteger(fieldyBackfillDays) || fieldyBackfillDays < 1) {
    throw new Error("FIELDY_BACKFILL_DAYS must be a positive integer");
  }

  return {
    fieldyApiKey: readRequiredEnv("FIELDY_API_KEY"),
    fieldyWebhookSecret: readRequiredEnv("FIELDY_WEBHOOK_SECRET"),
    fieldyBackfillDays,
  };
}

export function getOwnerUserId() {
  return readRequiredEnv("LIFELOG_OWNER_USER_ID");
}
```

- [ ] **Step 5: Run the environment tests and verify they pass**

Run:

```bash
node --test --experimental-strip-types tests/env.test.ts
```

Expected: PASS for all `env.test.ts` tests.

- [ ] **Step 6: Commit dependency and env helper changes**

Run:

```bash
git add package.json package-lock.json lib/env.ts tests/env.test.ts
git commit -m "feat: add private foundation environment helpers"
```

Expected: commit succeeds.

## Task 2: Database Schema, Types, and RLS

**Files:**
- Create: `supabase/migrations/20260616000000_private_owner_foundation.sql`
- Create: `lib/supabase/types.ts`
- Test: `tests/supabase-schema.test.ts`

- [ ] **Step 1: Write the schema text tests**

Create `tests/supabase-schema.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260616000000_private_owner_foundation.sql",
  "utf8",
);

test("migration creates private owner foundation tables", () => {
  for (const table of ["conversations", "transcriptions", "tasks", "sync_runs"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});

test("migration scopes RLS policies with select auth.uid", () => {
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(migration, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
});

test("migration defines idempotency constraints", () => {
  assert.match(migration, /unique \(user_id, fieldy_id\)/);
  assert.match(migration, /unique \(user_id, fieldy_segment_id\)/);
  assert.match(migration, /unique \(user_id, fieldy_task_id\)/);
});

test("migration avoids raw payload columns", () => {
  assert.doesNotMatch(migration, /raw_payload/);
  assert.match(migration, /fieldy_metadata jsonb not null default '\{\}'::jsonb/);
});
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/supabase-schema.test.ts
```

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Create the SQL migration**

Create `supabase/migrations/20260616000000_private_owner_foundation.sql`:

```sql
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fieldy_id text not null,
  title text,
  summary text,
  content text,
  keywords text[] not null default '{}',
  started_at timestamptz,
  ended_at timestamptz,
  fieldy_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fieldy_id)
);

create table public.transcriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  fieldy_segment_id text not null,
  speaker_label text,
  text text not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fieldy_segment_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  fieldy_task_id text not null,
  title text not null,
  status text not null,
  due_at timestamptz,
  fieldy_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fieldy_task_id)
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('webhook', 'backfill')),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  imported_count integer not null default 0,
  error_message text
);

create index conversations_user_started_at_idx
  on public.conversations (user_id, started_at desc nulls last);

create index transcriptions_conversation_id_idx
  on public.transcriptions (conversation_id);

create index tasks_user_status_idx
  on public.tasks (user_id, status);

create index sync_runs_user_started_at_idx
  on public.sync_runs (user_id, started_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create trigger transcriptions_set_updated_at
  before update on public.transcriptions
  for each row execute function public.set_updated_at();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;
alter table public.transcriptions enable row level security;
alter table public.tasks enable row level security;
alter table public.sync_runs enable row level security;

create policy "Owner can read conversations"
  on public.conversations for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owner can insert conversations"
  on public.conversations for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Owner can update conversations"
  on public.conversations for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owner can read transcriptions"
  on public.transcriptions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owner can insert transcriptions"
  on public.transcriptions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Owner can update transcriptions"
  on public.transcriptions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owner can read tasks"
  on public.tasks for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owner can insert tasks"
  on public.tasks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Owner can update tasks"
  on public.tasks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owner can read sync runs"
  on public.sync_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owner can insert sync runs"
  on public.sync_runs for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Owner can update sync runs"
  on public.sync_runs for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

- [ ] **Step 4: Create minimal Supabase database types**

Create `lib/supabase/types.ts`:

```ts
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Row<TColumns> = {
  Row: TColumns;
  Insert: Partial<TColumns>;
  Update: Partial<TColumns>;
};

export type Database = {
  public: {
    Tables: {
      conversations: Row<{
        id: string;
        user_id: string;
        fieldy_id: string;
        title: string | null;
        summary: string | null;
        content: string | null;
        keywords: string[];
        started_at: string | null;
        ended_at: string | null;
        fieldy_metadata: Json;
        created_at: string;
        updated_at: string;
      }>;
      transcriptions: Row<{
        id: string;
        user_id: string;
        conversation_id: string;
        fieldy_segment_id: string;
        speaker_label: string | null;
        text: string;
        started_at: string | null;
        ended_at: string | null;
        created_at: string;
        updated_at: string;
      }>;
      tasks: Row<{
        id: string;
        user_id: string;
        conversation_id: string | null;
        fieldy_task_id: string;
        title: string;
        status: string;
        due_at: string | null;
        fieldy_metadata: Json;
        created_at: string;
        updated_at: string;
      }>;
      sync_runs: Row<{
        id: string;
        user_id: string;
        source: "webhook" | "backfill";
        status: "running" | "succeeded" | "failed";
        started_at: string;
        finished_at: string | null;
        imported_count: number;
        error_message: string | null;
      }>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
```

- [ ] **Step 5: Run schema tests and verify they pass**

Run:

```bash
node --test --experimental-strip-types tests/supabase-schema.test.ts
```

Expected: PASS for all `supabase-schema.test.ts` tests.

- [ ] **Step 6: Commit schema and types**

Run:

```bash
git add supabase/migrations/20260616000000_private_owner_foundation.sql lib/supabase/types.ts tests/supabase-schema.test.ts
git commit -m "feat: add private lifelog database schema"
```

Expected: commit succeeds.

## Task 3: Supabase Auth Clients and Login Gate

**Files:**
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/admin.ts`
- Create: `lib/supabase/proxy.ts`
- Create: `proxy.ts`
- Create: `app/login/page.tsx`
- Create: `app/auth/actions.ts`
- Modify: `app/page.tsx`
- Test: `tests/supabase-client-source.test.ts`

- [ ] **Step 1: Write source-level tests for Supabase client boundaries**

Create `tests/supabase-client-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("admin client uses service key without cookies", () => {
  const source = readFileSync("lib/supabase/admin.ts", "utf8");

  assert.match(source, /createClient<Database>/);
  assert.match(source, /supabaseServiceRoleKey/);
  assert.doesNotMatch(source, /cookies\(/);
  assert.doesNotMatch(source, /Authorization/);
});

test("server client uses createServerClient with getAll cookies", () => {
  const source = readFileSync("lib/supabase/server.ts", "utf8");

  assert.match(source, /createServerClient<Database>/);
  assert.match(source, /getAll\(\)/);
  assert.match(source, /setAll/);
});

test("proxy refreshes auth through getUser", () => {
  const source = readFileSync("lib/supabase/proxy.ts", "utf8");

  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /setAll/);
});
```

- [ ] **Step 2: Run Supabase boundary tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/supabase-client-source.test.ts
```

Expected: FAIL because the Supabase client files do not exist.

- [ ] **Step 3: Create the server Supabase client**

Create `lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getClientEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = getClientEnv();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies; Server Actions and proxy can.
        }
      },
    },
  });
}
```

- [ ] **Step 4: Create the admin Supabase client**

Create `lib/supabase/admin.ts`:

```ts
import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

export function createSupabaseAdminClient() {
  const { supabaseUrl, supabaseServiceRoleKey } = getSupabaseAdminEnv();

  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
```

- [ ] **Step 5: Create Supabase session refresh proxy helper**

Create `lib/supabase/proxy.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getClientEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const { supabaseUrl, supabaseAnonKey } = getClientEnv();

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}
```

- [ ] **Step 6: Create root `proxy.ts`**

Create `proxy.ts`:

```ts
import { type NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
```

- [ ] **Step 7: Create email/password auth actions**

Create `app/auth/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function signInWithPassword(formData: FormData) {
  const email = readFormString(formData, "email");
  const password = readFormString(formData, "password");

  if (!email || !password) {
    redirect("/login?error=missing_credentials");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/login?error=invalid_credentials");
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 8: Create the login page**

Create `app/login/page.tsx`:

```tsx
import { signInWithPassword } from "@/app/auth/actions";

const errorCopy: Record<string, string> = {
  missing_credentials: "Enter an email and password.",
  invalid_credentials: "The email or password was not accepted.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const message = params.error ? errorCopy[params.error] : undefined;

  return (
    <main className="login-shell">
      <form action={signInWithPassword} className="login-panel">
        <h1>Fieldy Lifelog</h1>
        <p>Sign in to your private conversation archive.</p>
        {message ? <p className="login-error">{message}</p> : null}
        <label>
          Email
          <input autoComplete="email" name="email" required type="email" />
        </label>
        <label>
          Password
          <input autoComplete="current-password" name="password" required type="password" />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 9: Auth-gate the home page**

Replace `app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { LifelogDashboard } from "@/components/lifelog-dashboard";
import { getOwnerUserId } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
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

  return <LifelogDashboard />;
}
```

- [ ] **Step 10: Add minimal login styles**

Append to `app/globals.css`:

```css
.login-shell {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: var(--background);
}

.login-panel {
  display: grid;
  gap: 16px;
  width: min(100%, 380px);
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.login-panel h1,
.login-panel p {
  margin: 0;
}

.login-panel label {
  display: grid;
  gap: 7px;
  color: var(--muted);
  font-size: 14px;
  font-weight: 650;
}

.login-panel input {
  min-height: 42px;
  padding: 0 12px;
  color: var(--ink);
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  background: #fff;
}

.login-panel button {
  min-height: 42px;
  color: #fff;
  border: 0;
  border-radius: 7px;
  background: var(--green);
  font-weight: 720;
}

.login-error {
  color: #9b1c31;
  font-size: 14px;
}
```

- [ ] **Step 11: Run tests, lint, and build**

Run:

```bash
node --test --experimental-strip-types tests/supabase-client-source.test.ts
npm run lint
npm run build
```

Expected: tests PASS, lint PASS, build PASS.

- [ ] **Step 12: Commit Supabase auth foundation**

Run:

```bash
git add lib/supabase proxy.ts app/login app/auth app/page.tsx app/globals.css tests/supabase-client-source.test.ts
git commit -m "feat: add Supabase private owner auth"
```

Expected: commit succeeds.

## Task 4: Fieldy Types, Webhook Validation, and REST Client

**Files:**
- Modify: `lib/fieldy/types.ts`
- Modify: `lib/fieldy/webhook-validation.ts`
- Create: `lib/fieldy/client.ts`
- Modify: `tests/fieldy-webhook-validation.test.ts`
- Test: `tests/fieldy-client.test.ts`

- [ ] **Step 1: Replace webhook validation tests with documented payload coverage**

Replace `tests/fieldy-webhook-validation.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateFieldyWebhookPayload } from "../lib/fieldy/webhook-validation.ts";

test("rejects valid JSON that is not an object", () => {
  assert.deepEqual(validateFieldyWebhookPayload(null), {
    ok: false,
    status: 400,
    error: "JSON payload must be an object",
  });

  assert.deepEqual(validateFieldyWebhookPayload([]), {
    ok: false,
    status: 400,
    error: "JSON payload must be an object",
  });
});

test("rejects incomplete Fieldy transcription webhook payloads", () => {
  assert.deepEqual(validateFieldyWebhookPayload({ type: "conversation.processed" }), {
    ok: false,
    status: 422,
    error: "Unsupported or incomplete Fieldy webhook payload",
  });

  assert.deepEqual(
    validateFieldyWebhookPayload({
      date: "2026-06-16T12:00:00.000Z",
      transcription: "Hello",
      transcriptions: [{ text: "Hello", speaker: "A", start: 0, end: 1 }],
    }),
    {
      ok: false,
      status: 422,
      error: "Unsupported or incomplete Fieldy webhook payload",
    },
  );
});

test("accepts documented transcription-completed webhook payloads", () => {
  const result = validateFieldyWebhookPayload({
    date: "2026-06-16T12:00:00.000Z",
    transcription: "Hello from Fieldy.",
    transcriptions: [
      {
        text: "Hello from Fieldy.",
        speaker: "A",
        start: 0.04,
        end: 4.4,
        duration: 4.36,
      },
    ],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.transcriptions[0].speaker, "A");
  }
});
```

- [ ] **Step 2: Write Fieldy REST client tests**

Create `tests/fieldy-client.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { FieldyApiError, createFieldyClient } from "../lib/fieldy/client.ts";

test("fetchConversations pages through nextCursor with required date bounds", async () => {
  const urls: string[] = [];
  const client = createFieldyClient({
    apiKey: "sk-fieldy-test",
    fetchImpl: async (input) => {
      urls.push(String(input));
      const body =
        urls.length === 1
          ? {
              items: [{ id: "conversation-1", title: "First" }],
              nextCursor: "cursor-2",
            }
          : {
              items: [{ id: "conversation-2", title: "Second" }],
              nextCursor: null,
            };

      return new Response(JSON.stringify(body), { status: 200 });
    },
  });

  const items = await client.fetchConversations({
    startTime: "2026-06-01T00:00:00.000Z",
    endTime: "2026-06-16T00:00:00.000Z",
    mode: "intersects-range",
  });

  assert.deepEqual(items.map((item) => item.id), ["conversation-1", "conversation-2"]);
  assert.match(urls[0], /pageSize=50/);
  assert.match(urls[0], /mode=intersects-range/);
  assert.match(urls[0], /startTime=2026-06-01T00%3A00%3A00.000Z/);
  assert.match(urls[1], /cursor=cursor-2/);
});

test("fetchTranscriptions uses pageSize 1000 and required start time", async () => {
  const urls: string[] = [];
  const client = createFieldyClient({
    apiKey: "sk-fieldy-test",
    fetchImpl: async (input) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          items: [{ id: "segment-1", text: "Hi", timestamp: "2026-06-16T00:00:00.000Z" }],
          nextCursor: null,
        }),
        { status: 200 },
      );
    },
  });

  const items = await client.fetchTranscriptions({
    startTime: "2026-06-16T00:00:00.000Z",
    endTime: "2026-06-16T01:00:00.000Z",
  });

  assert.equal(items[0].id, "segment-1");
  assert.match(urls[0], /pageSize=1000/);
});

test("fetchTasks requests each documented task status", async () => {
  const urls: string[] = [];
  const client = createFieldyClient({
    apiKey: "sk-fieldy-test",
    fetchImpl: async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    },
  });

  await client.fetchTasks();

  assert.equal(urls.length, 7);
  assert(urls.some((url) => url.includes("status=completed")));
  assert(urls.some((url) => url.includes("status=expired")));
});

test("throws FieldyApiError for non-429 API failures", async () => {
  const client = createFieldyClient({
    apiKey: "sk-fieldy-test",
    fetchImpl: async () => new Response("nope", { status: 500 }),
  });

  await assert.rejects(
    () =>
      client.fetchConversations({
        startTime: "2026-06-01T00:00:00.000Z",
        endTime: "2026-06-16T00:00:00.000Z",
      }),
    (error) => error instanceof FieldyApiError && error.status === 500,
  );
});

test("retries one 429 response before succeeding", async () => {
  let calls = 0;
  const client = createFieldyClient({
    apiKey: "sk-fieldy-test",
    fallbackRetryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
    },
  });

  await client.fetchConversations({
    startTime: "2026-06-01T00:00:00.000Z",
    endTime: "2026-06-16T00:00:00.000Z",
  });

  assert.equal(calls, 2);
});
```

- [ ] **Step 3: Run Fieldy tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/fieldy-webhook-validation.test.ts tests/fieldy-client.test.ts
```

Expected: FAIL because the existing types/validation still expect `conversation.processed`, and `lib/fieldy/client.ts` does not exist.

- [ ] **Step 4: Replace Fieldy types**

Replace `lib/fieldy/types.ts` with:

```ts
export type FieldyWebhookSegment = {
  text: string;
  speaker: string;
  start: number;
  end: number;
  duration: number;
};

export type FieldyWebhookPayload = {
  date: string;
  transcription: string;
  transcriptions: FieldyWebhookSegment[];
};

export type FieldyConversation = {
  id: string;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  type?: string | null;
  keywords?: string[] | null;
  speakers?: unknown;
  quotes?: unknown;
  location?: unknown;
  templateId?: string | null;
  calendarEventId?: string | null;
  updatedAt?: string | null;
};

export type FieldyTranscription = {
  id?: string | null;
  text: string;
  timestamp?: string | null;
  speaker?: string | null;
  speakerProfileId?: string | null;
  start?: number | null;
  end?: number | null;
  createdAt?: string | null;
  source?: string | null;
};

export type FieldyTaskStatus =
  | "new"
  | "approved"
  | "completed"
  | "rejected"
  | "skipped"
  | "cancelled"
  | "expired";

export type FieldyTask = {
  id?: string | null;
  title: string;
  date?: string | null;
  status: FieldyTaskStatus;
  memoryId?: string | null;
  completionDate?: string | null;
  cancellationDate?: string | null;
};

export type FieldyPage<TItem> = {
  items: TItem[];
  nextCursor?: string | null;
};
```

- [ ] **Step 5: Replace webhook validation**

Replace `lib/fieldy/webhook-validation.ts` with:

```ts
import type { FieldyWebhookPayload } from "@/lib/fieldy/types";

type PayloadValidation =
  | {
      ok: true;
      payload: FieldyWebhookPayload;
    }
  | {
      ok: false;
      status: 400 | 422;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSegment(value: unknown) {
  if (!isRecord(value)) return false;

  return (
    typeof value.text === "string" &&
    typeof value.speaker === "string" &&
    typeof value.start === "number" &&
    typeof value.end === "number" &&
    typeof value.duration === "number"
  );
}

export function validateFieldyWebhookPayload(body: unknown): PayloadValidation {
  if (!isRecord(body)) {
    return { ok: false, status: 400, error: "JSON payload must be an object" };
  }

  if (
    typeof body.date !== "string" ||
    typeof body.transcription !== "string" ||
    !Array.isArray(body.transcriptions) ||
    body.transcriptions.length === 0 ||
    !body.transcriptions.every(isValidSegment)
  ) {
    return {
      ok: false,
      status: 422,
      error: "Unsupported or incomplete Fieldy webhook payload",
    };
  }

  return {
    ok: true,
    payload: body as FieldyWebhookPayload,
  };
}
```

- [ ] **Step 6: Create Fieldy REST client**

Create `lib/fieldy/client.ts`:

```ts
import type {
  FieldyConversation,
  FieldyPage,
  FieldyTask,
  FieldyTaskStatus,
  FieldyTranscription,
} from "@/lib/fieldy/types";

const FIELDY_API_BASE_URL = "https://api.fieldy.ai/api/public/v2";
const FIELDY_TASK_STATUSES: FieldyTaskStatus[] = [
  "new",
  "approved",
  "completed",
  "rejected",
  "skipped",
  "cancelled",
  "expired",
];

type FetchImpl = typeof fetch;

type FieldyClientOptions = {
  apiKey: string;
  fetchImpl?: FetchImpl;
  fallbackRetryDelayMs?: number;
  minRequestSpacingMs?: number;
};

type ConversationRange = {
  startTime: string;
  endTime: string;
  mode?: "starts-in-range" | "intersects-range";
};

type TranscriptionRange = {
  startTime: string;
  endTime?: string;
};

export class FieldyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createFieldyClient({
  apiKey,
  fetchImpl = fetch,
  fallbackRetryDelayMs = 60_000,
  minRequestSpacingMs = 0,
}: FieldyClientOptions) {
  let lastRequestAt = 0;

  async function waitForRequestSlot() {
    if (minRequestSpacingMs <= 0) return;

    const elapsedMs = Date.now() - lastRequestAt;
    if (elapsedMs < minRequestSpacingMs) {
      await sleep(minRequestSpacingMs - elapsedMs);
    }
  }

  async function requestJson<TResponse>(path: string, params: URLSearchParams) {
    const url = new URL(`${FIELDY_API_BASE_URL}${path}`);
    params.forEach((value, key) => url.searchParams.set(key, value));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await waitForRequestSlot();
      const response = await fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      lastRequestAt = Date.now();

      if (response.status === 429 && attempt === 0) {
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        const cooldownMs = Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds * 1000
          : fallbackRetryDelayMs;
        await sleep(cooldownMs);
        continue;
      }

      if (!response.ok) {
        throw new FieldyApiError(`Fieldy API request failed with ${response.status}`, response.status);
      }

      return (await response.json()) as TResponse;
    }

    throw new FieldyApiError("Fieldy API request failed with 429", 429);
  }

  function requestPage<TItem>(path: string, params: URLSearchParams) {
    return requestJson<FieldyPage<TItem>>(path, params);
  }

  async function collectPages<TItem>(path: string, params: URLSearchParams) {
    const items: TItem[] = [];
    let cursor: string | null | undefined;

    do {
      if (cursor) {
        params.set("cursor", cursor);
      } else {
        params.delete("cursor");
      }

      const page = await requestPage<TItem>(path, params);
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    return items;
  }

  return {
    fetchConversations(range: ConversationRange) {
      const params = new URLSearchParams({
        startTime: range.startTime,
        endTime: range.endTime,
        pageSize: "50",
      });
      if (range.mode) {
        params.set("mode", range.mode);
      }
      return collectPages<FieldyConversation>("/conversations", params);
    },

    fetchTranscriptions(range: TranscriptionRange) {
      const params = new URLSearchParams({
        startTime: range.startTime,
        pageSize: "1000",
      });
      if (range.endTime) {
        params.set("endTime", range.endTime);
      }
      return collectPages<FieldyTranscription>("/transcriptions", params);
    },

    async fetchTasks() {
      const allTasks: FieldyTask[] = [];
      for (const status of FIELDY_TASK_STATUSES) {
        const params = new URLSearchParams({ status });
        const page = await requestJson<{ items: FieldyTask[] }>("/tasks", params);
        allTasks.push(...page.items);
      }
      return allTasks;
    },
  };
}

export { FIELDY_TASK_STATUSES };
```

- [ ] **Step 7: Run Fieldy tests and verify they pass**

Run:

```bash
node --test --experimental-strip-types tests/fieldy-webhook-validation.test.ts tests/fieldy-client.test.ts
```

Expected: PASS for all Fieldy validation and client tests.

- [ ] **Step 8: Commit Fieldy API layer**

Run:

```bash
git add lib/fieldy tests/fieldy-webhook-validation.test.ts tests/fieldy-client.test.ts
git commit -m "feat: add Fieldy webhook and REST client layer"
```

Expected: commit succeeds.

## Task 5: Idempotency and Ingestion Core

**Files:**
- Create: `lib/lifelog/idempotency.ts`
- Create: `lib/lifelog/ingestion.ts`
- Test: `tests/lifelog-idempotency.test.ts`
- Test: `tests/lifelog-ingestion.test.ts`

- [ ] **Step 1: Write idempotency tests**

Create `tests/lifelog-idempotency.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveFieldySegmentId,
  deriveFieldyTaskId,
  hashStableValue,
} from "../lib/lifelog/idempotency.ts";

test("hashStableValue is stable for object key order", () => {
  assert.equal(
    hashStableValue({ b: 2, a: 1 }),
    hashStableValue({ a: 1, b: 2 }),
  );
});

test("deriveFieldySegmentId uses existing segment id when present", () => {
  assert.equal(
    deriveFieldySegmentId("conversation-1", {
      id: "segment-1",
      text: "Hello",
    }),
    "segment-1",
  );
});

test("deriveFieldySegmentId derives a stable id without a segment id", () => {
  const first = deriveFieldySegmentId("conversation-1", {
    text: "Hello",
    speaker: "A",
    start: 0,
    end: 1,
  });
  const second = deriveFieldySegmentId("conversation-1", {
    text: "Hello",
    speaker: "A",
    start: 0,
    end: 1,
  });

  assert.equal(first, second);
  assert.match(first, /^derived-segment-conversation-1-/);
});

test("deriveFieldyTaskId uses existing task id when present", () => {
  assert.equal(
    deriveFieldyTaskId("conversation-1", {
      id: "task-1",
      title: "Send notes",
      status: "new",
    }),
    "task-1",
  );
});

test("deriveFieldyTaskId derives a stable id without a task id", () => {
  const first = deriveFieldyTaskId("conversation-1", {
    title: "Send notes",
    status: "new",
    date: "2026-06-16",
  });
  const second = deriveFieldyTaskId("conversation-1", {
    title: "Send notes",
    status: "new",
    date: "2026-06-16",
  });

  assert.equal(first, second);
  assert.match(first, /^derived-task-conversation-1-/);
});
```

- [ ] **Step 2: Write ingestion normalization and upsert tests**

Create `tests/lifelog-ingestion.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createIngestionService,
  normalizeConversation,
  type IngestionSupabase,
} from "../lib/lifelog/ingestion.ts";

function createSupabaseTableRecorder() {
  const calls: Array<{ table: string; rows: unknown; options?: unknown }> = [];
  const records: Record<string, unknown[]> = {
    conversations: [{ id: "local-conversation-1", fieldy_id: "conversation-1" }],
  };

  return {
    calls,
    client: {
      from(table: string) {
        return {
          upsert(rows: unknown, options?: unknown) {
            calls.push({ table, rows, options });
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: records[table]?.[0] ?? null,
                      error: null,
                    });
                  },
                };
              },
              then(resolve: (value: { data: null; error: null }) => void) {
                resolve({ data: null, error: null });
              },
            };
          },
        };
      },
    },
  };
}

test("normalizeConversation maps canonical Fieldy records into minimized rows", () => {
  const normalized = normalizeConversation({
    ownerUserId: "owner-1",
    conversation: {
      id: "conversation-1",
      title: "Standup",
      summary: "Discussed launch",
      content: "Full text",
      keywords: ["launch"],
      startTime: "2026-06-16T10:00:00.000Z",
      endTime: "2026-06-16T10:30:00.000Z",
      location: { city: "Kansas City" },
      calendarEventId: "calendar-1",
    },
  });

  assert.deepEqual(normalized, {
    user_id: "owner-1",
    fieldy_id: "conversation-1",
    title: "Standup",
    summary: "Discussed launch",
    content: "Full text",
    keywords: ["launch"],
    started_at: "2026-06-16T10:00:00.000Z",
    ended_at: "2026-06-16T10:30:00.000Z",
    fieldy_metadata: {
      type: null,
      templateId: null,
      updatedAt: null,
    },
  });
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
    },
    transcriptions: [{ id: "segment-1", text: "Hi", speaker: "A" }],
    tasks: [{ id: "task-1", title: "Send notes", status: "new", memoryId: "conversation-1" }],
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
```

- [ ] **Step 3: Run ingestion tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/lifelog-idempotency.test.ts tests/lifelog-ingestion.test.ts
```

Expected: FAIL because `lib/lifelog/idempotency.ts` and `lib/lifelog/ingestion.ts` do not exist.

- [ ] **Step 4: Implement idempotency helpers**

Create `lib/lifelog/idempotency.ts`:

```ts
import { createHash } from "node:crypto";
import type { FieldyTask, FieldyTranscription } from "../fieldy/types";

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortStable);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortStable(nested)]),
    );
  }

  return value;
}

export function hashStableValue(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(sortStable(value)))
    .digest("hex")
    .slice(0, 24);
}

export function deriveFieldySegmentId(
  conversationId: string,
  segment: Pick<FieldyTranscription, "id" | "text" | "speaker" | "start" | "end" | "timestamp">,
) {
  if (segment.id) return segment.id;

  return `derived-segment-${conversationId}-${hashStableValue({
    text: segment.text,
    speaker: segment.speaker ?? null,
    start: segment.start ?? null,
    end: segment.end ?? null,
    timestamp: segment.timestamp ?? null,
  })}`;
}

export function deriveFieldyTaskId(
  conversationId: string,
  task: Pick<FieldyTask, "id" | "title" | "date" | "status">,
) {
  if (task.id) return task.id;

  return `derived-task-${conversationId}-${hashStableValue({
    title: task.title,
    date: task.date ?? null,
    status: task.status,
  })}`;
}
```

- [ ] **Step 5: Implement ingestion normalization and upserts**

Create `lib/lifelog/ingestion.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveFieldySegmentId, deriveFieldyTaskId } from "./idempotency";
import type { FieldyConversation, FieldyTask, FieldyTranscription } from "../fieldy/types";
import type { Database, Json } from "../supabase/types";

export type IngestionSupabase = Pick<SupabaseClient<Database>, "from">;

type ConversationSet = {
  conversation: FieldyConversation;
  transcriptions: FieldyTranscription[];
  tasks: FieldyTask[];
};

type IngestionOptions = {
  supabase: IngestionSupabase;
  ownerUserId: string;
};

function toIsoFromOffset(baseIso: string | null | undefined, offsetSeconds: number | null | undefined) {
  if (!baseIso || typeof offsetSeconds !== "number") return null;
  const baseMs = Date.parse(baseIso);
  if (Number.isNaN(baseMs)) return null;
  return new Date(baseMs + offsetSeconds * 1000).toISOString();
}

function buildConversationMetadata(conversation: FieldyConversation): Json {
  return {
    type: conversation.type ?? null,
    templateId: conversation.templateId ?? null,
    updatedAt: conversation.updatedAt ?? null,
  };
}

function buildTaskMetadata(task: FieldyTask): Json {
  return {
    memoryId: task.memoryId ?? null,
    completionDate: task.completionDate ?? null,
    cancellationDate: task.cancellationDate ?? null,
  };
}

export function normalizeConversation({
  ownerUserId,
  conversation,
}: {
  ownerUserId: string;
  conversation: FieldyConversation;
}) {
  return {
    user_id: ownerUserId,
    fieldy_id: conversation.id,
    title: conversation.title ?? null,
    summary: conversation.summary ?? null,
    content: conversation.content ?? null,
    keywords: conversation.keywords ?? [],
    started_at: conversation.startTime ?? null,
    ended_at: conversation.endTime ?? null,
    fieldy_metadata: buildConversationMetadata(conversation),
  };
}

export function createIngestionService({ supabase, ownerUserId }: IngestionOptions) {
  async function ingestConversationSet({ conversation, transcriptions, tasks }: ConversationSet) {
    const { data: savedConversation, error: conversationError } = await supabase
      .from("conversations")
      .upsert(normalizeConversation({ ownerUserId, conversation }), {
        onConflict: "user_id,fieldy_id",
      })
      .select()
      .single();

    if (conversationError) throw conversationError;
    if (!savedConversation) throw new Error("Conversation upsert returned no row");

    const transcriptionRows = transcriptions.map((segment) => ({
      user_id: ownerUserId,
      conversation_id: savedConversation.id,
      fieldy_segment_id: deriveFieldySegmentId(conversation.id, segment),
      speaker_label: segment.speaker ?? null,
      text: segment.text,
      started_at: segment.timestamp ?? toIsoFromOffset(conversation.startTime, segment.start ?? null),
      ended_at: toIsoFromOffset(conversation.startTime, segment.end ?? null),
    }));

    if (transcriptionRows.length > 0) {
      const { error } = await supabase.from("transcriptions").upsert(transcriptionRows, {
        onConflict: "user_id,fieldy_segment_id",
      });
      if (error) throw error;
    }

    const taskRows = tasks.map((task) => ({
      user_id: ownerUserId,
      conversation_id: task.memoryId === conversation.id ? savedConversation.id : null,
      fieldy_task_id: deriveFieldyTaskId(conversation.id, task),
      title: task.title,
      status: task.status,
      due_at: task.date ?? null,
      fieldy_metadata: buildTaskMetadata(task),
    }));

    if (taskRows.length > 0) {
      const { error } = await supabase.from("tasks").upsert(taskRows, {
        onConflict: "user_id,fieldy_task_id",
      });
      if (error) throw error;
    }

    return {
      conversationCount: 1,
      transcriptionCount: transcriptionRows.length,
      taskCount: taskRows.length,
    };
  }

  return { ingestConversationSet };
}
```

- [ ] **Step 6: Run ingestion tests and verify they pass**

Run:

```bash
node --test --experimental-strip-types tests/lifelog-idempotency.test.ts tests/lifelog-ingestion.test.ts
```

Expected: PASS for all idempotency and ingestion tests.

- [ ] **Step 7: Commit ingestion core**

Run:

```bash
git add lib/lifelog tests/lifelog-idempotency.test.ts tests/lifelog-ingestion.test.ts
git commit -m "feat: add idempotent lifelog ingestion core"
```

Expected: commit succeeds.

## Task 6: Fieldy Webhook Reconciliation Route

**Files:**
- Modify: `app/api/webhooks/fieldy/route.ts`
- Test: `tests/fieldy-webhook-route-source.test.ts`

- [ ] **Step 1: Write route source tests**

Create `tests/fieldy-webhook-route-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/api/webhooks/fieldy/route.ts", "utf8");

test("webhook route uses FIELDY_WEBHOOK_SECRET and documented validation", () => {
  assert.match(source, /fieldyWebhookSecret/);
  assert.match(source, /validateFieldyWebhookPayload/);
  assert.doesNotMatch(source, /FIELDY_WEBHOOK_TOKEN/);
  assert.doesNotMatch(source, /conversation\.processed/);
});

test("webhook route reconciles with Fieldy REST before ingestion", () => {
  assert.match(source, /fetchConversations/);
  assert.match(source, /fetchTranscriptions/);
  assert.match(source, /mode: "intersects-range"/);
  assert.match(source, /matchesWebhookPayload/);
  assert.match(source, /ingestConversationSet/);
});

test("webhook route records sync runs without raw transcript error text", () => {
  assert.match(source, /source: "webhook"/);
  assert.match(source, /error_message/);
  assert.doesNotMatch(source, /errorMessage:\s*validation\.payload/);
  assert.doesNotMatch(source, /validation\.payload\.transcription/);
});
```

- [ ] **Step 2: Run route source tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/fieldy-webhook-route-source.test.ts
```

Expected: FAIL because the route still uses old webhook-token/accepted-stub behavior.

- [ ] **Step 3: Replace Fieldy webhook route**

Replace `app/api/webhooks/fieldy/route.ts` with:

```ts
import { type NextRequest, NextResponse } from "next/server";
import { getFieldyEnv, getOwnerUserId } from "@/lib/env";
import { createFieldyClient } from "@/lib/fieldy/client";
import type { FieldyTranscription, FieldyWebhookPayload } from "@/lib/fieldy/types";
import { validateFieldyWebhookPayload } from "@/lib/fieldy/webhook-validation";
import { createIngestionService } from "@/lib/lifelog/ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const RECONCILIATION_WINDOW_MINUTES = 30;
const FIELDY_REQUEST_SPACING_MS = 2100;

function buildWindow(date: string) {
  const centerMs = Date.parse(date);
  if (Number.isNaN(centerMs)) {
    throw new Error("Invalid Fieldy webhook date");
  }

  const radiusMs = RECONCILIATION_WINDOW_MINUTES * 60 * 1000;
  return {
    startTime: new Date(centerMs - radiusMs).toISOString(),
    endTime: new Date(centerMs + radiusMs).toISOString(),
  };
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error && /Fieldy API request failed with \d+/.test(error.message)) {
    return error.message;
  }
  if (error instanceof Error && error.message === "Invalid Fieldy webhook date") {
    return error.message;
  }
  return "Fieldy webhook reconciliation failed";
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesWebhookPayload(
  payload: FieldyWebhookPayload,
  transcriptions: FieldyTranscription[],
) {
  const webhookText = normalizeText(payload.transcription);
  if (!webhookText) return false;

  const canonicalText = normalizeText(
    transcriptions.map((segment) => segment.text).join(" "),
  );

  return (
    canonicalText.includes(webhookText) ||
    payload.transcriptions.some((segment) =>
      canonicalText.includes(normalizeText(segment.text)),
    )
  );
}

async function createSyncRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  ownerUserId: string,
) {
  const { data, error } = await supabase
    .from("sync_runs")
    .insert({
      user_id: ownerUserId,
      source: "webhook",
      status: "running",
    })
    .select()
    .single();

  if (error || !data) {
    throw error ?? new Error("Sync run insert returned no row");
  }
  return data.id;
}

async function finishSyncRun({
  supabase,
  syncRunId,
  status,
  importedCount,
  errorMessage,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  syncRunId: string;
  status: "succeeded" | "failed";
  importedCount: number;
  errorMessage?: string;
}) {
  const { error } = await supabase
    .from("sync_runs")
    .update({
      status,
      imported_count: importedCount,
      error_message: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", syncRunId);

  if (error) throw error;
}

export async function POST(request: NextRequest) {
  const { fieldyApiKey, fieldyWebhookSecret } = getFieldyEnv();
  const ownerUserId = getOwnerUserId();
  const token = request.nextUrl.searchParams.get("secret");

  if (token !== fieldyWebhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const validation = validateFieldyWebhookPayload(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.status },
    );
  }

  const supabase = createSupabaseAdminClient();
  const syncRunId = await createSyncRun(supabase, ownerUserId);

  try {
    const window = buildWindow(validation.payload.date);
    const fieldy = createFieldyClient({
      apiKey: fieldyApiKey,
      minRequestSpacingMs: FIELDY_REQUEST_SPACING_MS,
    });
    const conversations = await fieldy.fetchConversations({
      ...window,
      mode: "intersects-range",
    });

    if (conversations.length === 0) {
      await finishSyncRun({
        supabase,
        syncRunId,
        status: "failed",
        importedCount: 0,
        errorMessage: "No canonical Fieldy conversation matched webhook date",
      });

      return NextResponse.json({
        accepted: true,
        importedCount: 0,
        status: "failed",
      });
    }

    const ingestion = createIngestionService({ supabase, ownerUserId });
    let importedCount = 0;
    let matchedCount = 0;

    for (const conversation of conversations) {
      const transcriptions = await fieldy.fetchTranscriptions({
        startTime: conversation.startTime ?? window.startTime,
        endTime: conversation.endTime ?? window.endTime,
      });

      if (!matchesWebhookPayload(validation.payload, transcriptions)) {
        continue;
      }

      const result = await ingestion.ingestConversationSet({
        conversation,
        transcriptions,
        tasks: [],
      });
      importedCount += result.conversationCount;
      matchedCount += 1;
    }

    if (matchedCount === 0) {
      await finishSyncRun({
        supabase,
        syncRunId,
        status: "failed",
        importedCount: 0,
        errorMessage: "No canonical Fieldy transcription matched webhook text",
      });

      return NextResponse.json({
        accepted: true,
        importedCount: 0,
        status: "failed",
      });
    }

    await finishSyncRun({
      supabase,
      syncRunId,
      status: "succeeded",
      importedCount,
    });

    return NextResponse.json({
      accepted: true,
      importedCount,
      status: "succeeded",
    });
  } catch (error) {
    await finishSyncRun({
      supabase,
      syncRunId,
      status: "failed",
      importedCount: 0,
      errorMessage: toSafeErrorMessage(error),
    });

    return NextResponse.json(
      { accepted: false, error: "Fieldy webhook reconciliation failed" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run route tests and full Fieldy tests**

Run:

```bash
node --test --experimental-strip-types tests/fieldy-webhook-route-source.test.ts tests/fieldy-webhook-validation.test.ts tests/fieldy-client.test.ts
```

Expected: PASS for route source, validation, and REST client tests.

- [ ] **Step 5: Commit webhook reconciliation**

Run:

```bash
git add app/api/webhooks/fieldy/route.ts tests/fieldy-webhook-route-source.test.ts
git commit -m "feat: reconcile Fieldy webhooks through REST"
```

Expected: commit succeeds.

## Task 7: Owner-Only Manual Backfill Action

**Files:**
- Create: `app/actions/backfill-fieldy.ts`
- Test: `tests/backfill-action-source.test.ts`

- [ ] **Step 1: Write backfill action source tests**

Create `tests/backfill-action-source.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/actions/backfill-fieldy.ts", "utf8");

test("backfill action verifies owner with getUser", () => {
  assert.match(source, /"use server"/);
  assert.match(source, /auth\.getUser\(\)/);
  assert.match(source, /getOwnerUserId/);
});

test("backfill action uses Fieldy pagination and ingestion", () => {
  assert.match(source, /fetchConversations/);
  assert.match(source, /fetchTranscriptions/);
  assert.match(source, /fetchTasks/);
  assert.match(source, /ingestConversationSet/);
});

test("backfill action revalidates the dashboard", () => {
  assert.match(source, /revalidatePath\("\/"\)/);
});
```

- [ ] **Step 2: Run backfill source tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/backfill-action-source.test.ts
```

Expected: FAIL because `app/actions/backfill-fieldy.ts` does not exist.

- [ ] **Step 3: Implement owner-only backfill action**

Create `app/actions/backfill-fieldy.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getFieldyEnv, getOwnerUserId } from "@/lib/env";
import { createFieldyClient } from "@/lib/fieldy/client";
import type { FieldyTask } from "@/lib/fieldy/types";
import { createIngestionService } from "@/lib/lifelog/ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const FIELDY_REQUEST_SPACING_MS = 2100;

function buildBackfillRange(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error && /Fieldy API request failed with \d+/.test(error.message)) {
    return error.message;
  }
  return "Fieldy backfill failed";
}

export async function backfillFieldy() {
  const ownerUserId = getOwnerUserId();
  const supabaseServer = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseServer.auth.getUser();

  if (!user || user.id !== ownerUserId) {
    return {
      ok: false,
      error: "Unauthorized",
    };
  }

  const { fieldyApiKey, fieldyBackfillDays } = getFieldyEnv();
  const supabase = createSupabaseAdminClient();

  const { data: syncRun, error: syncRunError } = await supabase
    .from("sync_runs")
    .insert({
      user_id: ownerUserId,
      source: "backfill",
      status: "running",
    })
    .select()
    .single();

  if (syncRunError || !syncRun) {
    throw syncRunError ?? new Error("Sync run insert returned no row");
  }

  try {
    const fieldy = createFieldyClient({
      apiKey: fieldyApiKey,
      minRequestSpacingMs: FIELDY_REQUEST_SPACING_MS,
    });
    const range = buildBackfillRange(fieldyBackfillDays);
    const conversations = await fieldy.fetchConversations(range);
    const tasks = await fieldy.fetchTasks();
    const ingestion = createIngestionService({ supabase, ownerUserId });
    let importedCount = 0;

    for (const conversation of conversations) {
      const transcriptions = await fieldy.fetchTranscriptions({
        startTime: conversation.startTime ?? range.startTime,
        endTime: conversation.endTime ?? range.endTime,
      });
      const conversationTasks: FieldyTask[] = tasks.filter(
        (task) => task.memoryId === conversation.id,
      );
      const result = await ingestion.ingestConversationSet({
        conversation,
        transcriptions,
        tasks: conversationTasks,
      });
      importedCount += result.conversationCount;
    }

    await supabase
      .from("sync_runs")
      .update({
        status: "succeeded",
        imported_count: importedCount,
        error_message: null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", syncRun.id);

    revalidatePath("/");

    return {
      ok: true,
      importedCount,
    };
  } catch (error) {
    await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        imported_count: 0,
        error_message: toSafeErrorMessage(error),
        finished_at: new Date().toISOString(),
      })
      .eq("id", syncRun.id);

    revalidatePath("/");

    return {
      ok: false,
      error: "Fieldy backfill failed",
    };
  }
}
```

- [ ] **Step 4: Run backfill source tests**

Run:

```bash
node --test --experimental-strip-types tests/backfill-action-source.test.ts
```

Expected: PASS for all backfill source tests.

- [ ] **Step 5: Commit backfill action**

Run:

```bash
git add app/actions/backfill-fieldy.ts tests/backfill-action-source.test.ts
git commit -m "feat: add owner-only Fieldy backfill action"
```

Expected: commit succeeds.

## Task 8: Persisted Dashboard Data and Sync UI

**Files:**
- Create: `lib/lifelog/dashboard-data.ts`
- Modify: `app/page.tsx`
- Modify: `components/lifelog-dashboard.tsx`
- Test: `tests/dashboard-data.test.ts`

- [ ] **Step 1: Write dashboard data mapper tests**

Create `tests/dashboard-data.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { mapDashboardData } from "../lib/lifelog/dashboard-data.ts";

test("mapDashboardData groups conversations and counts open tasks", () => {
  const result = mapDashboardData({
    conversations: [
      {
        id: "local-1",
        fieldy_id: "fieldy-1",
        title: "Standup",
        summary: "Launch plan",
        started_at: "2026-06-16T10:00:00.000Z",
        ended_at: "2026-06-16T10:30:00.000Z",
        keywords: ["launch"],
      },
    ],
    tasks: [
      {
        id: "task-1",
        title: "Send notes",
        status: "new",
        due_at: null,
        conversation_id: "local-1",
      },
    ],
    syncRuns: [
      {
        id: "sync-1",
        source: "backfill",
        status: "succeeded",
        started_at: "2026-06-16T12:00:00.000Z",
        finished_at: "2026-06-16T12:01:00.000Z",
        imported_count: 1,
        error_message: null,
      },
    ],
  });

  assert.equal(result.conversations[0].title, "Standup");
  assert.equal(result.openTaskCount, 1);
  assert.equal(result.lastSync?.status, "succeeded");
});

test("mapDashboardData handles empty imported state", () => {
  const result = mapDashboardData({
    conversations: [],
    tasks: [],
    syncRuns: [],
  });

  assert.equal(result.conversations.length, 0);
  assert.equal(result.openTaskCount, 0);
  assert.equal(result.lastSync, null);
});
```

- [ ] **Step 2: Run dashboard data tests and verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-data.test.ts
```

Expected: FAIL because `lib/lifelog/dashboard-data.ts` does not exist.

- [ ] **Step 3: Create dashboard data helper**

Create `lib/lifelog/dashboard-data.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type DashboardConversationRow = {
  id: string;
  fieldy_id: string;
  title: string | null;
  summary: string | null;
  started_at: string | null;
  ended_at: string | null;
  keywords: string[];
};

export type DashboardTaskRow = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  conversation_id: string | null;
};

export type DashboardSyncRunRow = {
  id: string;
  source: "webhook" | "backfill";
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  imported_count: number;
  error_message: string | null;
};

export type DashboardData = {
  conversations: Array<{
    id: string;
    fieldyId: string;
    title: string;
    summary: string;
    startedAt: string | null;
    endedAt: string | null;
    keywords: string[];
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueAt: string | null;
    conversationId: string | null;
  }>;
  openTaskCount: number;
  lastSync: DashboardSyncRunRow | null;
};

export function mapDashboardData({
  conversations,
  tasks,
  syncRuns,
}: {
  conversations: DashboardConversationRow[];
  tasks: DashboardTaskRow[];
  syncRuns: DashboardSyncRunRow[];
}): DashboardData {
  return {
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      fieldyId: conversation.fieldy_id,
      title: conversation.title ?? "Untitled conversation",
      summary: conversation.summary ?? "No summary available yet.",
      startedAt: conversation.started_at,
      endedAt: conversation.ended_at,
      keywords: conversation.keywords,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.due_at,
      conversationId: task.conversation_id,
    })),
    openTaskCount: tasks.filter((task) => task.status !== "completed").length,
    lastSync: syncRuns[0] ?? null,
  };
}

export async function getDashboardData(supabase: SupabaseClient<Database>) {
  const [{ data: conversations, error: conversationsError }, { data: tasks, error: tasksError }, { data: syncRuns, error: syncRunsError }] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id, fieldy_id, title, summary, started_at, ended_at, keywords")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(50),
      supabase
        .from("tasks")
        .select("id, title, status, due_at, conversation_id")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("sync_runs")
        .select("id, source, status, started_at, finished_at, imported_count, error_message")
        .order("started_at", { ascending: false })
        .limit(1),
    ]);

  if (conversationsError) throw conversationsError;
  if (tasksError) throw tasksError;
  if (syncRunsError) throw syncRunsError;

  return mapDashboardData({
    conversations: conversations ?? [],
    tasks: tasks ?? [],
    syncRuns: syncRuns ?? [],
  });
}
```

- [ ] **Step 4: Update `app/page.tsx` to load dashboard data**

Replace `app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { LifelogDashboard } from "@/components/lifelog-dashboard";
import { getOwnerUserId } from "@/lib/env";
import { getDashboardData } from "@/lib/lifelog/dashboard-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
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

  const dashboardData = await getDashboardData(supabase);

  return <LifelogDashboard data={dashboardData} />;
}
```

- [ ] **Step 5: Update dashboard component props and empty/sync states**

Modify `components/lifelog-dashboard.tsx` by making these structural changes:

```tsx
import { backfillFieldy } from "@/app/actions/backfill-fieldy";
import type { DashboardData } from "@/lib/lifelog/dashboard-data";
```

Change the component signature:

```tsx
export function LifelogDashboard({ data }: { data: DashboardData }) {
```

Replace mock conversation/task state initialization with data-backed values:

```tsx
  const [activeTab, setActiveTab] = useState<ConversationFilterTab>("All");
  const [chatInput, setChatInput] = useState("");
  const [recallAnswer, setRecallAnswer] = useState(
    data.conversations.length > 0
      ? `Your private archive has ${data.conversations.length} imported conversations and ${data.openTaskCount} open action items.`
      : "Import Fieldy data to start building your private archive.",
  );

  const conversations = data.conversations.map((conversation): Conversation => ({
    id: conversation.id,
    time: conversation.startedAt
      ? new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(conversation.startedAt))
      : "No time",
    title: conversation.title,
    people: conversation.keywords.length > 0 ? conversation.keywords.join(", ") : "Fieldy",
    summary: conversation.summary,
    duration: "Imported",
    tasks: data.tasks.filter((task) => task.conversationId === conversation.id).length,
    type: "conversation",
    day: "today",
  }));

  const tasks = data.tasks.map((task): Task => ({
    id: task.id,
    title: task.title,
    source: "Fieldy",
    due: task.dueAt ? new Intl.DateTimeFormat("en-US").format(new Date(task.dueAt)) : "No due date",
    done: task.status === "completed",
  }));
```

Remove the local task toggle function. Imported task status is read-only in this phase.

```tsx
// Remove toggleTask entirely.
```

Replace the existing sidebar `Sync Fieldy` button with this form so the sidebar has only one sync control:

```tsx
        <form action={backfillFieldy}>
          <button className="sync-button" type="submit">
            <RefreshCcw aria-hidden="true" size={18} />
            Sync Fieldy
          </button>
        </form>
```

Replace the task checkbox input with a disabled read-only checkbox:

```tsx
                    <input checked={task.done} disabled readOnly type="checkbox" />
```

Show empty state inside the timeline card before timeline groups:

```tsx
              {visibleConversations.length === 0 ? (
                <section className="empty-state">
                  <h2>No Fieldy conversations imported yet</h2>
                  <p>Run a manual sync to backfill your recent Fieldy history.</p>
                </section>
              ) : null}
```

Add a last-sync status line near the metrics:

```tsx
              <article className="metric sync-metric">
                <p>Sync status</p>
                <strong>
                  <Check aria-hidden="true" size={19} />
                  {data.lastSync?.status ?? "Not synced"}
                </strong>
                <span>
                  {data.lastSync?.error_message ??
                    (data.lastSync?.finished_at
                      ? `Last sync ${new Intl.DateTimeFormat("en-US").format(new Date(data.lastSync.finished_at))}`
                      : "Run a sync to import Fieldy data")}
                </span>
              </article>
```

Add to `app/globals.css`:

```css
.empty-state {
  display: grid;
  gap: 8px;
  padding: 36px 20px;
  text-align: center;
  border-top: 1px solid var(--border);
}

.empty-state h2,
.empty-state p {
  margin: 0;
}

.empty-state p {
  color: var(--muted);
}
```

- [ ] **Step 6: Run dashboard tests and build**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-data.test.ts
npm run lint
npm run build
```

Expected: dashboard tests PASS, lint PASS, build PASS.

- [ ] **Step 7: Commit dashboard persistence UI**

Run:

```bash
git add lib/lifelog/dashboard-data.ts app/page.tsx components/lifelog-dashboard.tsx app/globals.css tests/dashboard-data.test.ts
git commit -m "feat: render persisted lifelog dashboard data"
```

Expected: commit succeeds.

## Task 9: Documentation and Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README setup instructions**

Replace `README.md` with:

```md
# Fieldy Lifelog

Fieldy-integrated private lifelog web app for searchable conversations, summaries, action items, and recall.

## Local Development

```bash
npm install
npm run dev
```

## Required Environment

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
LIFELOG_OWNER_USER_ID=...
FIELDY_API_KEY=sk-fieldy-...
FIELDY_WEBHOOK_SECRET=...
FIELDY_BACKFILL_DAYS=30
```

`SUPABASE_SERVICE_ROLE_KEY`, `FIELDY_API_KEY`, and `FIELDY_WEBHOOK_SECRET` are server-only secrets. Do not expose them with a `NEXT_PUBLIC_` prefix.

## Supabase Setup

Apply the migration in `supabase/migrations/20260616000000_private_owner_foundation.sql` to create:

- `conversations`
- `transcriptions`
- `tasks`
- `sync_runs`

All tables have RLS enabled and owner-scoped policies.

Create the owner user in Supabase Auth, then set `LIFELOG_OWNER_USER_ID` to that auth user id.

## Fieldy Setup

Create a Fieldy API key from Fieldy Developer Settings and set `FIELDY_API_KEY`.

Configure the Fieldy webhook URL without secrets in the URL:

```text
https://your-app.example.com/api/webhooks/fieldy
```

Configure the webhook request header `X-Fieldy-Webhook-Secret` with the value of `FIELDY_WEBHOOK_SECRET`.

Fieldy public webhook docs currently describe completed transcription payloads. The app uses each webhook as a reconciliation trigger and fetches canonical conversation/transcription data from the Fieldy Public API.

## Verification

```bash
npm test
npm run lint
npm run build
```
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all tests PASS, lint PASS, build PASS.

- [ ] **Step 3: Check worktree status**

Run:

```bash
git status --short --branch
```

Expected: only intentional changes are present. `.superpowers/` may remain untracked from brainstorming and should not be included unless the user asks.

- [ ] **Step 4: Commit documentation**

Run:

```bash
git add README.md
git commit -m "docs: document private owner foundation setup"
```

Expected: commit succeeds.

## Self-Review Notes

- Spec coverage: Tasks cover dependencies/env, schema/RLS, Supabase SSR/admin auth boundaries, Fieldy REST/webhook assumptions, idempotent ingestion, webhook reconciliation, manual backfill, dashboard persisted data, sync states, documentation, and verification.
- Red-flag scan: The plan avoids incomplete markers, deferred-work markers, and generic edge-case instructions. Each code-changing step includes concrete code or a precise code patch target.
- Type consistency: `FIELDY_WEBHOOK_SECRET`, `fieldy_metadata`, `createSupabaseServerClient`, `createSupabaseAdminClient`, `createFieldyClient`, `createIngestionService`, `ingestConversationSet`, and `DashboardData` are introduced before later tasks reference them.
