# Fieldy Lifelog

Fieldy-integrated lifelog web app for searchable conversations, summaries, action items, and recall.

## Local Development

```bash
npm install
npm run dev
```

The first app slice includes a local dashboard/timeline experience and a protected Fieldy webhook stub at `/api/webhooks/fieldy?token=...`.

Required environment variable for webhook testing:

```bash
FIELDY_WEBHOOK_TOKEN=replace-me
```
