# Private Owner Foundation Design

## Purpose

Phase A turns the Fieldy Lifelog scaffold into a real private data foundation. The app will support one configured owner account, authenticated with Supabase email/password auth, and will persist Fieldy conversations from both live webhooks and a protected manual backfill.

This phase is intentionally not a multi-user SaaS implementation. It keeps `user_id` on stored records and uses Row Level Security from the start so the data model can grow later without rewriting the core tables.

## Current Context

The repository is a young Next.js App Router app. The current UI is a mock-data dashboard in `components/lifelog-dashboard.tsx`. The current Fieldy webhook route validates a minimal `conversation.processed` payload and returns an accepted response, but it does not persist data. Existing tests cover webhook payload validation and dashboard filter behavior.

Context7 checks were run for current Supabase and Next.js guidance. Supabase guidance supports per-request server clients, verified `getUser()` for identity-sensitive server routes/actions, and RLS policies such as `auth.uid() = user_id`. Supabase SSR guidance emphasizes creating a new server client per request with cookie accessors. Next.js guidance supports Server Actions for protected mutations and `revalidatePath` after mutations. Context7 did not find indexed Fieldy developer docs under the product name or domain, so implementation must validate final Fieldy payload and REST field mappings against the real Fieldy account/docs before locking mappings.

## Architecture

The app will have three server-side boundaries:

1. Authenticated dashboard reads use the normal Supabase SSR client so RLS applies naturally.
2. The Fieldy webhook route validates a shared secret token, validates supported payloads, and uses a server-only Supabase service-role client to persist rows under the configured owner id.
3. A protected manual backfill Server Action verifies the signed-in user is the configured owner, calls the Fieldy REST API with a server-only API key, persists normalized rows through the same ingestion module as the webhook, and revalidates the dashboard route.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIELDY_WEBHOOK_TOKEN`
- `FIELDY_API_KEY`
- `LIFELOG_OWNER_USER_ID`
- `FIELDY_BACKFILL_DAYS`, optional, defaulting to 30 if omitted

Service-role access is limited to server-only ingestion code. Browser code never receives Fieldy secrets, service-role credentials, or raw sync errors containing sensitive data.

## Data Model

Phase A adds four core tables: `conversations`, `transcriptions`, `tasks`, and `sync_runs`.

`conversations` is the anchor table. It stores `id`, `user_id`, `fieldy_id`, title, summary, content, keywords, started and ended timestamps, timestamps for local creation/update, and `raw_payload` for Fieldy fields not normalized yet. The idempotency constraint is unique `(user_id, fieldy_id)`.

`transcriptions` stores transcript segments connected to `conversations`. It stores `id`, `user_id`, `conversation_id`, optional `fieldy_segment_id`, speaker label, text, started and ended timestamps, and local timestamps. When Fieldy provides segment ids, the idempotency constraint is unique `(user_id, fieldy_segment_id)`. If Fieldy does not provide segment ids, implementation should derive a stable `fieldy_segment_id` from conversation id, timestamps, speaker label, and text hash before insert.

`tasks` stores action items connected to conversations when possible. It stores `id`, `user_id`, optional `conversation_id`, `fieldy_task_id`, title, status, due timestamp, local timestamps, and `raw_payload`. When Fieldy does not provide a task id, implementation should derive a stable `fieldy_task_id` from conversation id, title, due timestamp, and raw task hash. The idempotency constraint is unique `(user_id, fieldy_task_id)`.

`sync_runs` records operational ingestion state. It stores `id`, `user_id`, source (`webhook` or `backfill`), status (`running`, `succeeded`, or `failed`), started and finished timestamps, imported count, and a short non-sensitive error message.

All user-facing tables use RLS policies scoped to `auth.uid() = user_id`. Service-role ingestion must always set `user_id` to `LIFELOG_OWNER_USER_ID`; it must not infer ownership from payload content in Phase A.

Deferred tables and fields:

- Embeddings and vector indexes
- Tags as first-class records
- Speaker/contact identity tables
- Share links
- Retry queue or scheduled sync job tables

## Ingestion Flow

Webhook and backfill share one normalization/upsert module. The module accepts supported Fieldy conversation payloads, converts them into the Phase A table shapes, and performs idempotent upserts.

Webhook flow:

1. Require `FIELDY_WEBHOOK_TOKEN` to be configured.
2. Compare the request token to `FIELDY_WEBHOOK_TOKEN`.
3. Parse JSON and validate `conversation.processed` with a non-empty conversation id.
4. Normalize the conversation, transcriptions, and tasks present in the payload.
5. Upsert all rows under `LIFELOG_OWNER_USER_ID`.
6. Record a `sync_runs` row with source `webhook`.
7. Return an accepted response with the Fieldy conversation id and imported entity names.

Backfill flow:

1. Run as a Server Action available only from authenticated app UI.
2. Use Supabase `getUser()` and require the signed-in user id to equal `LIFELOG_OWNER_USER_ID`.
3. Create a `sync_runs` row with source `backfill` and status `running`.
4. Fetch a bounded recent window from Fieldy REST, defaulting to the last 30 days.
5. Page through conversations. If the conversation response does not include transcription/task details, fetch the documented related transcription/task endpoints for the same time window or conversation ids.
6. Normalize and upsert through the same ingestion module used by the webhook.
7. Mark the sync run as `succeeded` with imported count, or `failed` with a short non-sensitive error.
8. Call `revalidatePath("/")` so the dashboard reflects imported data.

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

- Bad webhook token returns `401`.
- Signed-out or non-owner backfill attempts are unauthorized.
- User-facing queries rely on RLS and owner checks.

Input and configuration failures are explicit:

- Malformed webhook JSON returns `400`.
- Unsupported or incomplete Fieldy events return `422`.
- Missing required server configuration returns `500` with non-secret error text.

Operational errors are recorded in `sync_runs.error_message` with short, non-sensitive messages such as `Fieldy API request failed with 429` or `LIFELOG_OWNER_USER_ID is not configured`. Raw payload content, API keys, tokens, transcript text, and full stack traces are not stored in `error_message`.

## Testing

Tests should stay focused on trust boundaries and pure transformations:

- Payload validation for supported and unsupported Fieldy webhook events
- Fieldy payload normalization into conversation, transcription, and task records
- Idempotent upsert behavior for repeated webhook/backfill data
- Webhook token behavior and configuration failure behavior
- Backfill owner check behavior
- SQL migration review for RLS policies and owner-scoped access

If the implementation adds a local Supabase test harness, add integration checks for RLS and persistence. If it does not, keep database verification as migration-level review plus focused unit tests around the server code that constructs database writes.

## Out of Scope

This phase will not implement semantic recall chat, embeddings, hybrid search, Fieldy MCP integration, multi-user Fieldy connections, billing, teams, scheduled background sync, large-scale retry orchestration, or a full design-system rewrite.

## Success Criteria

Phase A is complete when:

- A configured owner can sign in with email/password.
- Private app data is unavailable to signed-out users.
- Database tables exist with RLS enabled and owner-scoped policies.
- Fieldy webhook events persist conversations and related entities idempotently.
- The owner can manually backfill a bounded recent Fieldy history window.
- The dashboard reads persisted conversations instead of hard-coded mock conversations.
- Sync status and failures are visible without exposing secrets or raw sensitive content.
- Tests cover the validation, normalization, auth, and idempotency boundaries above.
