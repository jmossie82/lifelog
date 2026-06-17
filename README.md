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
LIFELOG_DISPLAY_TIME_ZONE=America/Chicago
OPENAI_API_KEY=sk-...
LIFELOG_EMBEDDING_MODEL=text-embedding-3-small
```

`SUPABASE_SERVICE_ROLE_KEY`, `FIELDY_API_KEY`, `FIELDY_WEBHOOK_SECRET`, and `OPENAI_API_KEY` are server-only secrets. Do not expose them with a `NEXT_PUBLIC_` prefix.
`LIFELOG_DISPLAY_TIME_ZONE` is optional and defaults to `America/Chicago`; set it to the owner's IANA time zone for dashboard grouping and display.
`LIFELOG_EMBEDDING_MODEL` is optional and currently must be `text-embedding-3-small`.

## Supabase Setup

Apply the migration in `supabase/migrations/20260616000000_private_owner_foundation.sql` to create:

- `lifelog_owner_config`
- `conversations`
- `transcriptions`
- `tasks`
- `sync_runs`

All tables have RLS enabled. Owner data tables expose authenticated read policies only for the configured owner. Ingestion and backfill writes use the server-only Supabase service role.

Apply `supabase/migrations/20260617000000_semantic_recall_v1.sql` after the private owner foundation migration to enable pgvector semantic recall. The migration adds conversation embeddings and an owner-scoped `match_conversations` RPC.

Create the owner user in Supabase Auth, then set `LIFELOG_OWNER_USER_ID` to that auth user id. Insert or update the singleton owner config row with the same id:

```sql
insert into public.lifelog_owner_config (id, user_id)
values (1, 'LIFELOG_OWNER_USER_ID')
on conflict (id) do update set user_id = excluded.user_id;
```

## Fieldy Setup

Create a Fieldy API key from Fieldy Developer Settings and set `FIELDY_API_KEY`.

Configure the Fieldy webhook URL in the Fieldy mobile app with the app-owned secret in the URL:

```text
https://your-app.example.com/api/webhooks/fieldy?secret=FIELDY_WEBHOOK_SECRET_VALUE
```

Fieldy public webhook docs currently describe completed transcription payloads. The app uses each webhook as a reconciliation trigger and fetches canonical conversation/transcription data from the Fieldy Public API.

## Verification

After importing Fieldy conversations, run **Embed conversations** from the dashboard before using Semantic recall. Embeddings are private app data and should be treated like transcript content.

```bash
npm test
npm run lint
npm run build
```
