# Private Owner Foundation Design

## Purpose

Phase A turns the Fieldy Lifelog scaffold into a real private data foundation. The app will support one configured owner account, authenticated with Supabase email/password auth, and will persist Fieldy conversations from both live webhooks and a protected manual backfill.

This phase is intentionally not a multi-user SaaS implementation. It keeps `user_id` on stored records and uses Row Level Security from the start so the data model can grow later without rewriting the core tables.

## Current Context

The repository is a young Next.js App Router app. The current UI is a mock-data dashboard in `components/lifelog-dashboard.tsx`. The current Fieldy webhook route validates a minimal `conversation.processed` payload and returns an accepted response, but it does not persist data. Existing tests cover webhook payload validation and dashboard filter behavior.

Context7 checks were run for current Supabase and Next.js guidance. Supabase guidance supports per-request server clients, verified `getUser()` for identity-sensitive server routes/actions, and RLS policies such as `(select auth.uid()) = user_id`. Supabase SSR guidance emphasizes creating a new server client per request with cookie accessors. Next.js guidance supports Server Actions for protected mutations and `revalidatePath` after mutations.

Fieldy primary docs were checked after the first design pass. The public API docs confirm the base path `https://api.fieldy.ai/api/public/v2`, bearer API key auth, conversations/transcriptions/tasks resources, cursor pagination, and a 30 requests per 60 seconds rate limit. The public webhook docs currently document completed transcription events, not signed `conversation.processed` events. Their documented payload contains `date`, `transcription`, and `transcriptions[]` segment objects; public docs do not confirm an HMAC signature, delivery id, retry header, event name, or conversation id. The design below treats webhooks as reconciliation triggers unless the live Fieldy account/docs prove a richer webhook payload is available.

Primary Fieldy sources used for this revision:

- `https://fieldyai.github.io/docs/public-api.md`
- `https://fieldyai.github.io/docs/webhooks.md`
- `https://api.fieldy.ai/docs`

## Architecture

The app will have three server-side boundaries:

1. Authenticated dashboard reads use the normal Supabase SSR client so RLS applies naturally.
2. The Fieldy webhook route validates an app-owned secret token, validates documented transcription-completed payloads, and uses server-only code to reconcile nearby canonical Fieldy REST data under the configured owner id.
3. A protected manual backfill Server Action verifies the signed-in user is the configured owner, calls the Fieldy REST API with a server-only API key, persists normalized rows through the same ingestion module as the webhook, and revalidates the dashboard route.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIELDY_WEBHOOK_SECRET`
- `FIELDY_API_KEY`
- `LIFELOG_OWNER_USER_ID`
- `FIELDY_BACKFILL_DAYS`, optional, defaulting to 30 if omitted

Supabase SSR clients must be created per request with `createServerClient` from `@supabase/ssr`, using the Next.js `cookies()` API and `cookies.getAll()`. Middleware must provide `cookies.setAll()` so token refreshes are persisted. Route Handlers and Server Actions may omit `setAll` only when middleware is responsible for cookie refresh persistence.

`SUPABASE_SERVICE_ROLE_KEY` is a server-only Supabase service or secret key value, which may be a legacy `service_role` key or a newer secret key. It must never use a `NEXT_PUBLIC_` prefix or be imported by browser/client modules. The service-role/admin Supabase client must be a separate server-only client created with `@supabase/supabase-js`. It must not use the SSR cookie client and must not forward request cookies, user sessions, or user `Authorization` headers.

`FIELDY_WEBHOOK_SECRET` is an app-owned high-entropy secret embedded in the configured webhook URL path or query string unless Fieldy confirms support for custom auth headers or signed webhooks. This is not a Fieldy-provided signature model.

Service-role access is limited to server-only ingestion code. Browser code never receives Fieldy secrets, service-role credentials, or raw sync errors containing sensitive data.

## Data Model

Phase A adds five core tables: `lifelog_owner_config`, `conversations`, `transcriptions`, `tasks`, and `sync_runs`.

`lifelog_owner_config` stores the ownership singleton that anchors the private-owner RLS model. It stores `id`, `user_id`, and local timestamps, with a single-row check requiring `id = 1`. After applying the migration, setup must explicitly insert or update this row with the same Supabase Auth user id configured in `LIFELOG_OWNER_USER_ID`.

`conversations` is the anchor table. It stores `id`, `user_id`, `fieldy_id`, title, summary, content, keywords, started and ended timestamps, timestamps for local creation/update, and a minimized `fieldy_metadata` JSON object for non-sensitive Fieldy fields not normalized yet. The idempotency constraint is unique `(user_id, fieldy_id)`.

`transcriptions` stores transcript segments connected to `conversations`. It stores `id`, `user_id`, `conversation_id`, optional `fieldy_segment_id`, speaker label, text, started and ended timestamps, and local timestamps. When Fieldy provides segment ids, the idempotency constraint is unique `(user_id, fieldy_segment_id)`. If Fieldy does not provide segment ids, implementation should derive a stable `fieldy_segment_id` from conversation id, timestamps, speaker label, and text hash before insert.

`tasks` stores action items connected to conversations when possible. It stores `id`, `user_id`, optional `conversation_id`, `fieldy_task_id`, title, status, due timestamp, local timestamps, and a minimized `fieldy_metadata` JSON object. When Fieldy does not provide a task id, implementation should derive a stable `fieldy_task_id` from conversation id, title, due timestamp, and task hash. The idempotency constraint is unique `(user_id, fieldy_task_id)`.

`sync_runs` records operational ingestion state. It stores `id`, `user_id`, source (`webhook` or `backfill`), status (`running`, `succeeded`, or `failed`), started and finished timestamps, imported count, and a short non-sensitive error message.

For each owner-scoped table, enable RLS and create authenticated owner read policies. Read policies should use `public.is_lifelog_owner(user_id)`, where the security-definer helper requires `(select auth.uid()) = user_id` and a matching row in `lifelog_owner_config`. Authenticated browser clients do not receive insert or update policies for owner data tables. Service-role ingestion bypasses these policies only through the separate server-only admin client, and it must always set `user_id` to `LIFELOG_OWNER_USER_ID`; it must not infer ownership from payload content in Phase A.

Do not store full raw Fieldy payloads by default because they can include transcript text, summaries, speaker data, quotes, location, and calendar metadata. If debugging requires payload retention, store only a redacted/minimized JSON subset, protect it with RLS, and define an explicit retention/deletion policy before implementation.

Deferred tables and fields:

- Embeddings and vector indexes
- Tags as first-class records
- Speaker/contact identity tables
- Share links
- Retry queue or scheduled sync job tables

## Ingestion Flow

Webhook and backfill share one normalization/upsert module. The module accepts canonical Fieldy REST conversation, transcription, and task records, converts them into the Phase A table shapes, and performs idempotent upserts.

Webhook flow:

1. Require `FIELDY_WEBHOOK_SECRET` to be configured.
2. Compare the request token to `FIELDY_WEBHOOK_SECRET`.
3. Parse JSON and validate the documented Fieldy transcription-completed payload: `date`, `transcription`, and `transcriptions[]` with `text`, `speaker`, `start`, `end`, and `duration`.
4. Record a `sync_runs` row with source `webhook`.
5. Because the public webhook payload does not document a conversation id, treat the webhook as a reconciliation trigger. Fetch canonical Fieldy conversations/transcriptions around the webhook `date`, using a narrow time window that implementation defines after checking real data behavior.
6. Normalize and upsert the canonical REST records under `LIFELOG_OWNER_USER_ID`.
7. If no canonical conversation can be matched, mark the sync run failed with a short non-sensitive reason and do not create a synthetic conversation row from webhook text alone.
8. Return an accepted response with imported count and sync status.

Backfill flow:

1. Run as a Server Action available only from authenticated app UI.
2. Use Supabase `getUser()` and require the signed-in user id to equal `LIFELOG_OWNER_USER_ID`.
3. Create a `sync_runs` row with source `backfill` and status `running`.
4. Fetch a bounded recent window from Fieldy REST, defaulting to the last 30 days.
5. Page through `GET /conversations` with required `startTime` and `endTime` parameters using `cursor = nextCursor`, with `pageSize <= 50`.
6. Fetch transcript segments with `GET /transcriptions` for each conversation time range using `cursor = nextCursor` and `pageSize <= 1000`.
7. Fetch tasks through documented status-filtered `GET /tasks?status=...` calls for supported statuses: `new`, `approved`, `completed`, `rejected`, `skipped`, `cancelled`, and `expired`. Associate tasks to conversations only when `memoryId` can be confirmed to match the Fieldy conversation/memory id. Otherwise persist tasks without a conversation link or defer task import.
8. Honor the 30 requests per 60 seconds Fieldy API limit and back off on `429`.
9. Normalize and upsert through the same ingestion module used by the webhook reconciliation path.
10. Mark the sync run as `succeeded` with imported count, or `failed` with a short non-sensitive error.
11. Call `revalidatePath("/")` so the dashboard reflects imported data.

Backfill is manual in Phase A. Scheduled sync, retry backoff, and open-ended historical import are deliberately deferred.

## UI Behavior

The dashboard becomes auth-gated. Signed-out users see a login path for email/password auth. Signed-in non-owner users cannot access the private dashboard or trigger sync.

The dashboard should replace static mock data with server-loaded records from Supabase. It should include these states:

- Signed out
- Signed in with no imported data
- Imported timeline data
- Sync running
- Last sync failed

The existing layout can remain recognizable. This phase is about durable data and privacy boundaries, not a broad visual redesign.

## Error Handling

Privacy failures fail closed:

- Bad webhook secret returns `401`.
- Signed-out or non-owner backfill attempts are unauthorized.
- User-facing queries rely on RLS and owner checks.

Input and configuration failures are explicit:

- Malformed webhook JSON returns `400`.
- Unsupported or incomplete Fieldy events return `422`.
- Missing required server configuration returns `500` with non-secret error text.

Operational errors are recorded in `sync_runs.error_message` with short, non-sensitive messages such as `Fieldy API request failed with 429` or `LIFELOG_OWNER_USER_ID is not configured`. Raw payload content, API keys, tokens, transcript text, and full stack traces are not stored in `error_message`.

Service-role ingestion and backfill operations do not rely on RLS policy enforcement for ownership. The server-only admin client bypasses RLS and explicitly writes `user_id = LIFELOG_OWNER_USER_ID` in normalized rows and sync runs. RLS ownership validation through `is_lifelog_owner()` applies to authenticated user queries, where `auth.uid()` is present and can be compared with the singleton owner config row.

## Testing

Tests should stay focused on trust boundaries and pure transformations:

- Payload validation for supported and unsupported Fieldy webhook events
- Fieldy payload normalization into conversation, transcription, and task records
- Idempotent upsert behavior for repeated webhook/backfill data
- Webhook secret behavior and configuration failure behavior
- Backfill owner check behavior
- SQL migration review for RLS policies and owner-scoped access
- Fieldy pagination and `429` backoff behavior in the REST client

If the implementation adds a local Supabase test harness, add integration checks for RLS and persistence. If it does not, keep database verification as migration-level review plus focused unit tests around the server code that constructs database writes.

## Out of Scope

This phase will not implement semantic recall chat, embeddings, hybrid search, Fieldy MCP integration, multi-user Fieldy connections, billing, teams, scheduled background sync, large-scale retry orchestration, or a full design-system rewrite.

## Success Criteria

Phase A is complete when:

- A configured owner can sign in with email/password.
- Private app data is unavailable to signed-out users.
- Database tables exist with RLS enabled and owner-scoped policies.
- Fieldy webhook events trigger canonical REST reconciliation and persist matched conversations and related entities idempotently.
- The owner can manually backfill a bounded recent Fieldy history window.
- The dashboard reads persisted conversations instead of hard-coded mock conversations.
- Sync status and failures are visible without exposing secrets or raw sensitive content.
- Tests cover the validation, normalization, auth, and idempotency boundaries above.
