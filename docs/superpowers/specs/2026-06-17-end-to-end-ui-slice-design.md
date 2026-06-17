# End-to-End UI Slice Design

## Goal

Build the first functional UI slice for the private Fieldy lifelog app. The slice should let the owner sign in, run or inspect Fieldy sync activity, search the persisted archive from Supabase, filter the dashboard, open a dedicated conversation page, and read the full stored transcript.

This is not the Recall Chat or semantic search milestone. The slice focuses on making the existing Supabase-backed ingestion useful through the UI.

## Current State

The backend foundation is already in place:

- Supabase Auth gates the private owner dashboard.
- RLS-protected tables store conversations, transcriptions, tasks, sync runs, and owner config.
- Fieldy webhook reconciliation and manual backfill write through shared ingestion code.
- The dashboard currently reads persisted conversations, tasks, and the latest sync run.
- The UI contains many decorative controls that do not yet drive server-backed behavior.

The current verification commands pass: `npm test`, `npm run lint`, and `npm run build`.

## Product Scope

The first slice makes `/` a real archive entry point:

- The dashboard shows a functional sync activity panel.
- The dashboard search and filters are backed by Supabase queries, not only client-side filtering of preloaded rows.
- Search and filter state lives in URL query params so refresh, browser navigation, and sharing preserve state.
- Conversation rows link to `/conversations/[id]`.
- The conversation detail page shows summary, metadata, keywords, linked tasks, and full transcript segments.
- Recall Chat remains out of scope for this slice. Existing preview UI can stay, but it should not imply that AI recall is implemented.

The core user loop is: sign in, sync, search, filter, open a conversation, read the transcript.

## Non-Goals

- AI Recall Chat, embeddings, pgvector, or LLM-generated answers.
- Editing Fieldy tasks or writing task status changes back to Supabase.
- Tagging, speaker profile management, sharing, or calendar enrichment.
- Realtime sync subscriptions.
- A separate `/search` page.
- Client-only debounced live search as the primary search mechanism.

## Architecture

Use a URL-driven, server-rendered dashboard plus a dedicated detail route.

`app/page.tsx` will accept Next 16 async search params, authenticate the owner as it does today, normalize supported params, and call an expanded dashboard data helper. Use an explicit `{ searchParams: Promise<Record<string, string | string[] | undefined>> }` prop shape, await `searchParams` once in the server page, normalize through a pure helper, and pass only normalized state to the client dashboard. The helper owns Supabase query construction and mapping. Server-side reads continue to use the per-request Supabase SSR client so RLS remains the read boundary.

`components/lifelog-dashboard.tsx` remains a client component for interactive controls and local pending states. It receives the canonical result set from the server, initializes controls from normalized search state, updates URL params when the user submits search or changes filters, and renders links to conversation detail pages.

Add `app/conversations/[id]/page.tsx` for the dedicated conversation page. This route uses Next 16 async params, authenticates the owner, validates the internal UUID, reads one conversation through the authenticated server Supabase client, loads full transcript rows ordered by `started_at`, loads linked tasks, and renders a server-provided detail model. Use an explicit `{ params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }` prop shape. Put query and mapping logic in `lib/lifelog/conversation-detail.ts` so the page stays thin and the behavior is easy to test.

Keep `backfillFieldy` as the sync mutation, but give it an explicit action-state contract for the UI. Define `BackfillActionState` as `{ status: "idle" | "success" | "error"; message: string; importedCount: number | null }`. Adapt the server action to the `useActionState` signature, `backfillFieldy(prevState, formData): Promise<BackfillActionState>`, while preserving the existing owner authorization and `revalidatePath("/")` behavior. The dashboard can still use the latest persisted `sync_runs` row as the durable source of last-run truth.

## Dashboard URL Params

Supported dashboard params:

- `q`: optional search string. Trim whitespace and ignore empty values.
- `type`: optional conversation type filter. Supported values map to the existing tabs: `all`, `conversation`, `note`, `task`, `mention`. Since there is no `conversations.type` column, implementation must filter on `fieldy_metadata->>type` for non-default Fieldy types. `type=conversation` must include rows whose metadata type is absent, null, unknown, or explicitly `conversation`, matching the current mapper fallback.
- `range`: optional date filter. Start with `all`, `today`, and `week`, calculated in `LIFELOG_DISPLAY_TIME_ZONE`.
- `page`: optional positive integer for URL-driven pagination.

Invalid params normalize to defaults:

- `q`: empty string
- `type`: `all`
- `range`: `all`
- `page`: `1`

Normalize and cap values on the server. The UI should show the normalized state, not raw invalid params.

Date range semantics:

- `today`: conversations with `started_at` on the current display-time-zone day.
- `week`: rolling 7-day window ending at the current render time, calculated as UTC instants from `LIFELOG_DISPLAY_TIME_ZONE`.
- `all`: no date filter.
- Rows with null `started_at` are excluded from `today` and `week` filters and remain visible for `all`.

## Server-Backed Search

Search should query the persisted archive on the server. For this slice, use Supabase/PostgREST filters over `conversations`:

- Match `title`, `summary`, and `content`.
- Use case-insensitive matching with `ilike`.
- Combine fields with `.or()` so any matching text field returns the conversation.
- Keep result ordering by `started_at` descending, matching the current dashboard.
- Preserve existing owner/RLS behavior by querying through the authenticated server client.

The search implementation must use a named helper, `buildConversationSearchFilter(q)`, rather than assembling the `.or()` string inline. The helper must:

- Trim and cap `q` to a fixed maximum length.
- Return no search filter for empty input.
- Escape or encode PostgREST filter reserved characters so commas, periods, colons, parentheses, quotes, and backslashes cannot produce malformed filters.
- Escape literal LIKE wildcards `%` and `_` unless a future design intentionally supports wildcard search.
- Have tests for empty strings, very long input, commas, periods, parentheses, quotes, backslashes, `%`, `_`, and operator-looking input.

Search query clauses, type filters, range filters, ordering, and pagination must all be applied in the Supabase query. Do not fetch a limited default result set and then filter it client-side.

Pagination should operate on the searched result set, not on the pre-filtered default list.

Pagination rules:

- Use a fixed `DASHBOARD_PAGE_SIZE` of 25.
- Treat `page` as cumulative load-more depth, not page replacement. `page=1` renders rows 0-24, `page=2` renders rows 0-49, and so on.
- Cap `page` to a fixed maximum to prevent unbounded ranges.
- Query with `.select(columns, { count: "exact" })` and `.range(0, page * DASHBOARD_PAGE_SIZE - 1)`.
- Order before range with `started_at desc nulls last`, plus a stable `id` tie-breaker.
- Return `totalCount`, `shownCount`, and `hasMore` from the dashboard data helper.

## Sync Activity Panel

Replace the existing sidebar device card and standalone sync button with one clear sidebar sync activity panel. It must show:

- Primary action: `Sync Fieldy`.
- Pending state while the form action is running.
- Last run source: `backfill` or `webhook`.
- Last run status: `running`, `succeeded`, or `failed`.
- Imported count.
- Finished time when available.
- Safe error message when available.

The panel must not render raw Fieldy payloads, transcripts, API keys, owner IDs, or sensitive identifiers. Add a mapper boundary for sync display data before it reaches the component. The mapper should expose only `source`, `status`, `importedCount`, `finishedAt`, and a sanitized, truncated display error. It should treat persisted `sync_runs.error_message` as untrusted display input even though current writers try to store safe messages.

## Dashboard Interactions

The dashboard should support:

- Search submit from the top search input.
- A clear-search action when `q` is active.
- Tab/type filters that update URL params.
- Range filter that updates URL params.
- A `Load more` link or button that advances the `page` URL param and preserves active `q`, `type`, and `range` params.
- Conversation row links to the detail route.

Use explicit search submission for this slice. Debounced search can be added later after the server-backed query path is stable.

## Conversation Detail Page

`/conversations/[id]` should render:

- Back link to the dashboard. Dashboard links to details should include a `from` query param containing the current dashboard query string so the detail page can return to the same search/filter state.
- Conversation title, started/ended time, duration, and Fieldy type.
- Summary.
- Keywords.
- Full transcript from `transcriptions`, ordered by `started_at` ascending with stable handling for null timestamps.
- Speaker labels when available.
- Segment timestamps when available.
- Linked tasks with status and due date.

If no transcript segments are stored, show an explicit empty transcript state. Since this slice is meant to implement full transcript rendering, do not silently substitute summary/content as the transcript happy path.

Detail route query behavior:

- Invalid UUID params return `notFound()` without querying.
- Fetch the conversation with the per-request authenticated server Supabase client, never the service-role/admin client.
- Use `.eq("id", id).maybeSingle()`.
- Return `notFound()` for no row or RLS invisibility.
- Throw unexpected Supabase errors instead of hiding them as not-found.
- Query `transcriptions` and `tasks` only after the conversation is authorized, filtering both by the authorized `conversation.id`.

## Error Handling And Empty States

- Sync pending disables the sync button and labels the pending state clearly.
- Sync success shows imported count and completion time.
- Sync failure shows only the existing safe error text.
- No imported conversations keeps the current empty import state and points to Sync Fieldy.
- No search matches shows a distinct no-results state and a clear-filter action.
- Invalid URL params are normalized to defaults.
- Detail route misses use `notFound()`.
- Detail transcript with no rows shows an empty transcript state.

## Testing

Add focused tests for:

- Dashboard param normalization.
- Dashboard data helper applying server-backed text search.
- Dashboard data helper applying type/range filters and pagination.
- Search query escaping or safe filter construction.
- Search and filters applied before pagination, with no client-side post-filtering after a limited result set.
- Bounded `.range()` math, `DASHBOARD_PAGE_SIZE`, page caps, `totalCount`, `shownCount`, and `hasMore`.
- Dashboard source using URL-driven controls and links to `/conversations/[id]`.
- Sync activity panel source rendering pending/success/failure states from action state and latest sync run data.
- Sync display mapper redacting raw-looking API keys, owner UUIDs, Fieldy IDs, and transcript-like content from display errors.
- Conversation detail mapper ordering transcript rows and mapping linked tasks.
- Conversation detail route source using owner-authenticated server reads, invalid UUID handling, `notFound()` for no row/RLS invisibility, and unexpected-error propagation.

Continue running:

- `npm test`
- `npm run lint`
- `npm run build`

## Implementation Notes

- Prefer server components and thin server pages for data reads.
- Keep private helpers close to the dashboard and detail data modules.
- Preserve strict TypeScript and named exports.
- Do not introduce a new UI framework for this slice.
- Keep raw lifelog content out of logs and error messages.
- Use current Next.js and Supabase docs when implementing the server action/search details.
