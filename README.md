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

Configure the Fieldy webhook URL with the app-owned secret:

```text
https://your-app.example.com/api/webhooks/fieldy?secret=FIELDY_WEBHOOK_SECRET_VALUE
```

Fieldy public webhook docs currently describe completed transcription payloads. The app uses each webhook as a reconciliation trigger and fetches canonical conversation/transcription data from the Fieldy Public API.

## Verification

```bash
npm test
npm run lint
npm run build
```
