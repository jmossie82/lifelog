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

`app/page.tsx` will accept `searchParams`, authenticate the owner as it does today, normalize supported params, and call an expanded dashboard data helper. The helper owns Supabase query construction and mapping. Server-side reads continue to use the per-request Supabase SSR client so RLS remains the read boundary.

`components/lifelog-dashboard.tsx` remains a client component for interactive controls and local pending states. It receives the canonical result set from the server, initializes controls from normalized search state, updates URL params when the user submits search or changes filters, and renders links to conversation detail pages.

Add `app/conversations/[id]/page.tsx` for the dedicated conversation page. This route authenticates the owner, reads one conversation by internal UUID, loads full transcript rows ordered by `started_at`, loads linked tasks, and renders a server-provided detail model. Put query and mapping logic in `lib/lifelog/conversation-detail.ts` so the page stays thin and the behavior is easy to test.

Keep `backfillFieldy` as the sync mutation. Adapt its UI integration so the sync form can show pending, success, and failure state in the sync activity panel. The action should still revalidate `/` after completion.

## Dashboard URL Params

Supported dashboard params:

- `q`: optional search string. Trim whitespace and ignore empty values.
- `type`: optional conversation type filter. Supported values map to the existing tabs: `all`, `conversation`, `note`, `task`, `mention`.
- `range`: optional date filter. Start with `all`, `today`, and `week`, calculated in `LIFELOG_DISPLAY_TIME_ZONE`.
- `page`: optional positive integer for URL-driven pagination.

Invalid params normalize to defaults:

- `q`: empty string
- `type`: `all`
- `range`: `all`
- `page`: `1`

The UI should show the normalized state, not raw invalid params.

## Server-Backed Search

Search should query the persisted archive on the server. For this slice, use Supabase/PostgREST filters over `conversations`:

- Match `title`, `summary`, and `content`.
- Use case-insensitive matching with `ilike`.
- Combine fields with `.or()` so any matching text field returns the conversation.
- Keep result ordering by `started_at` descending, matching the current dashboard.
- Preserve existing owner/RLS behavior by querying through the authenticated server client.

The search implementation should escape or sanitize user input for PostgREST filter syntax so punctuation does not produce malformed filters.

Pagination should operate on the searched result set, not on the pre-filtered default list.

## Sync Activity Panel

Replace the existing sidebar device card and standalone sync button with one clear sidebar sync activity panel. It must show:

- Primary action: `Sync Fieldy`.
- Pending state while the form action is running.
- Last run source: `backfill` or `webhook`.
- Last run status: `running`, `succeeded`, or `failed`.
- Imported count.
- Finished time when available.
- Safe error message when available.

The panel must not render raw Fieldy payloads, transcripts, API keys, owner IDs, or sensitive identifiers.

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

If the conversation is missing or inaccessible under RLS, return `notFound()`.

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
- Dashboard source using URL-driven controls and links to `/conversations/[id]`.
- Sync activity panel source rendering pending/success/failure states from action state and latest sync run data.
- Conversation detail mapper ordering transcript rows and mapping linked tasks.
- Conversation detail route source using owner-authenticated server reads and `notFound()` for misses.

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
