# Fieldy Lifelog Web App — Architecture, API Connections & Tech Stack

## Executive Summary

Fieldy is a HIPAA-compliant wearable AI note-taker that converts ambient conversations into searchable transcripts, summaries, tasks, and speaker-labeled memories. Building a lifelog web app on top of Fieldy means combining its Public REST API and real-time webhooks with a modern full-stack that can store, enrich, and surface that data as a personal intelligence layer. The recommended stack — **Next.js 15 + Supabase (PostgreSQL + pgvector) + Vercel** — maps directly onto your existing SaaS toolchain and gives you semantic search, real-time sync, and AI-powered recall out of the box.[^1][^2]

***

## Fieldy Integration Layer

### Public API (REST)

The Fieldy Public API is the primary data source for your lifelog:[^3][^4]

- **Base URL:** `https://api.fieldy.ai/api/public/v2`
- **Auth:** Bearer token (`sk-fieldy-...`) generated in Fieldy Developer Settings
- **Rate limit:** 30 requests/minute — use pagination + retry-backoff for sync jobs

**Available endpoints and their data:**

| Resource | Key Fields |
|---|---|
| `/conversations` | title, summaries, content, timestamps, location, keywords, quotes |
| `/transcriptions` | timestamped segments, speaker labels |
| `/tasks` | action items, status, due dates |
| `/speakers` | named speakers, voice identifiers |
| `/memory-templates` | prompts that shape Fieldy's summaries |
| `/sharable-links` | links for sharing conversation subsets |
| `/user` | basic account details |

**Example — fetch recent conversations:**
```bash
curl -H "Authorization: Bearer sk-fieldy-..." \
  "https://api.fieldy.ai/api/public/v2/conversations?startTime=2026-06-01T00:00:00Z&endTime=2026-06-16T23:59:59Z&pageSize=20"
```

**Example — fetch transcript segments:**
```bash
curl -H "Authorization: Bearer sk-fieldy-..." \
  "https://api.fieldy.ai/api/public/v2/transcriptions?startTime=2026-06-01T09:00:00Z&endTime=2026-06-01T10:00:00Z&pageSize=100"
```

### Webhooks (Real-Time Push)

Webhooks let Fieldy push data to your app the moment a conversation is processed, eliminating the need for polling:[^5]

1. Go to **Fieldy App → Settings → Developer Settings**
2. Paste your webhook endpoint URL (e.g., `https://your-app.vercel.app/api/webhooks/fieldy`)
3. Fieldy begins delivering POST payloads automatically — no additional toggle required

The webhook fires on processed conversation events and delivers a JSON payload with the same conversation/transcription structure available via REST. You can also wire Fieldy webhooks through **Zapier** (Catch Hook trigger) to fan-out into other tools (Notion, Google Sheets, Slack) alongside your custom app.[^5]

### MCP (Model Context Protocol)

For the AI chat interface within your lifelog, the Fieldy MCP endpoint (`https://api.fieldy.ai/mcp`) enables natural language queries over your conversation history:[^3]

- Connect it to Claude, ChatGPT, or a custom AI chat UI in your app
- Ask things like: *"What commitments did I make last week?"* or *"Summarize all conversations about the ticketing app"*
- Authorize via browser OAuth using your Fieldy app email

### Native Integrations Available in Fieldy

Fieldy natively connects to:[^6][^7]
- **Google Calendar** (associate memories with calendar events)
- **Outlook Calendar**
- **Google Tasks** (auto-created action items)

These can complement your lifelog by enriching conversation records with calendar context.

***

## Recommended Tech Stack

### Core Principle

Given your existing proficiency with React, Supabase, and Vercel, this stack is a zero-new-toolchain build. Every component integrates cleanly with Fieldy's API pattern.

| Layer | Technology | Version (June 2026) | Why |
|---|---|---|---|
| Frontend | **Next.js** (App Router) | **16.2.9** (LTS) | PPR via `cacheComponents`, Turbopack default, React 19.2, explicit opt-in caching[^8][^9][^10] |
| Styling | **Tailwind CSS** | **4.3.1** | CSS-first config, `@import "tailwindcss"`, no `tailwind.config.js` needed[^11][^12] |
| Components | **shadcn/ui + CLI v4** | **shadcn@4.11.0** | Unified `radix-ui` package (new-york style), agent-aware CLI, design system presets[^13][^14][^15] |
| Backend/DB | **Supabase** (`@supabase/supabase-js`) | **2.105.4** | Real-time subscriptions, RLS, Auth with passkey/WebAuthn support, Storage[^16] |
| Vector Search | **pgvector** (via Supabase) | Latest Supabase-managed | HNSW index for semantic search; no external vector DB needed[^17][^18] |
| Embeddings | **OpenAI `text-embedding-3-small`** | Current (not deprecated) | $0.02/M tokens; 1536-dim vectors; confirmed not being deprecated[^19][^20] |
| Webhook Receiver | **Next.js Route Handler** | — | `/api/webhooks/fieldy` receives Fieldy pushes; upserts to Supabase[^21][^22] |
| Deployment | **Vercel** | — | Auto CI/CD from GitHub; Edge Functions for low-latency webhook processing |
| AI Chat | **Vercel AI SDK** (`ai`) | **5.0.176** | SSE-based streaming, `useChat` hook from `@ai-sdk/react@2.x`, type-safe chat[^23][^24][^25] |
| AI Model (RAG) | **`gpt-5.4-mini`** via `@ai-sdk/openai` | Current | Fast, cost-efficient ($0.75/$4.50 per MTok); 400K context; optimized for RAG synthesis[^26][^27][^28] |
| AI Model (rich) | **`gpt-5.4`** via `@ai-sdk/openai` | Current | Higher-quality responses for complex multi-hop queries; 1M context; 3x cost of mini[^26][^29] |
| Auth | **Supabase Auth** | — | RLS per user; passkey/WebAuthn support added in 2.105.0[^16] |
| Middleware | **`proxy.ts`** (Next.js 16) | — | Replaces deprecated `middleware.ts`; handles auth session refresh[^9][^22] |

***

## Database Schema Design

### Core Tables

```sql
-- Synced directly from Fieldy API
CREATE TABLE conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users NOT NULL,
  fieldy_id     TEXT UNIQUE NOT NULL,            -- Fieldy's conversation ID
  title         TEXT,
  summary       TEXT,
  content       TEXT,                            -- Full conversation content
  location      JSONB,                           -- lat/lng if captured
  keywords      TEXT[],
  quotes        JSONB,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  embedding     extensions.vector(1536),         -- pgvector semantic embedding (extensions schema)
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Raw transcript segments
CREATE TABLE transcriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations NOT NULL,
  speaker_label   TEXT,
  text            TEXT NOT NULL,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ
);

-- Action items extracted by Fieldy
CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users NOT NULL,
  conversation_id UUID REFERENCES conversations,
  fieldy_task_id  TEXT UNIQUE,
  title           TEXT NOT NULL,
  status          TEXT DEFAULT 'pending',        -- pending | done | dismissed
  due_at          TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- User-defined tags for organizing memories
CREATE TABLE tags (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  TEXT NOT NULL,
  user_id UUID REFERENCES auth.users NOT NULL,
  UNIQUE(name, user_id)
);

CREATE TABLE conversation_tags (
  conversation_id UUID REFERENCES conversations,
  tag_id          UUID REFERENCES tags,
  PRIMARY KEY (conversation_id, tag_id)
);

-- RLS: users see only their own data
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversations" ON conversations
  USING (auth.uid() = user_id);
```

### Embedding Pipeline

When a conversation is ingested (via webhook or API sync), generate and store an embedding. Note that in Supabase, `pgvector` lives in the `extensions` schema — use `extensions.vector` in DDL and `JSON.stringify()` the array when inserting via the JS client:[^18][^30]

```typescript
// supabase/functions/embed-conversation/index.ts (Edge Function)
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })

export async function embedConversation(fieldy_id: string, content: string) {
  const { data } = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: content,
  })
  const embedding = JSON.stringify(data.embedding) // required for pgvector via supabase-js
  await supabase
    .from('conversations')
    .update({ embedding })
    .eq('fieldy_id', fieldy_id)
}
```

Enable pgvector and create an HNSW index for fast similarity search:[^18]

```sql
CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;
CREATE INDEX ON conversations USING hnsw (embedding extensions.vector_cosine_ops);
```

***

## Application Architecture

### Data Ingestion Flow

```
Fieldy Pendant → Fieldy App (Bluetooth) → Fieldy Cloud
    ↓ (webhook POST or REST poll)
Next.js Route Handler (/api/webhooks/fieldy)
    ↓ (upsert conversation/transcriptions/tasks)
Supabase PostgreSQL
    ↓ (Supabase Edge Function trigger)
OpenAI Embeddings → pgvector column updated
```

For scheduled backfill (e.g., syncing the past 30 days on first login), use a Next.js Server Action or a Supabase Edge Function that pages through the Fieldy REST API with date-range filters.

### Webhook Receiver (Next.js Route Handler)

Next.js 16 note: `params` in page components are now Promises — but Route Handlers are unaffected. The key Next.js 16 change here is renaming `middleware.ts` → `proxy.ts` for auth session handling.[^9][^22][^31]

```typescript
// app/api/webhooks/fieldy/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  const payload = await req.json()
  const supabase = await createClient()
  
  // Verify webhook token from query param
  const token = req.nextUrl.searchParams.get('token')
  if (token !== process.env.FIELDY_WEBHOOK_TOKEN) {
    return new Response('Unauthorized', { status: 401 })
  }

  const { type, conversation, transcriptions, tasks } = payload

  if (type === 'conversation.processed') {
    await supabase.from('conversations').upsert({
      fieldy_id:  conversation.id,
      title:      conversation.title,
      summary:    conversation.summary,
      content:    conversation.content,
      keywords:   conversation.keywords,
      started_at: conversation.startTime,
      ended_at:   conversation.endTime,
    }, { onConflict: 'fieldy_id' })
    
    // Trigger embedding generation asynchronously
    await supabase.functions.invoke('embed-conversation', {
      body: { fieldy_id: conversation.id }
    })
  }

  return new Response('OK', { status: 200 })
}
```

### Auth Proxy (replaces `middleware.ts` in Next.js 16)

```typescript
// proxy.ts (root of project — replaces middleware.ts)
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

### Semantic Search (RAG Query)

```typescript
// lib/search.ts
export async function semanticSearch(query: string, userId: string) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  })
  const queryEmbedding = JSON.stringify(res.data.embedding) // stringify for pgvector
  
  const { data } = await supabase.rpc('match_conversations', {
    query_embedding: queryEmbedding,
    match_threshold: 0.75,
    match_count: 10,
    p_user_id: userId,
  })
  return data
}
```

```sql
-- Supabase RPC function for semantic search
CREATE OR REPLACE FUNCTION match_conversations(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
RETURNS TABLE(id uuid, title text, summary text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.title, c.summary,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM conversations c
  WHERE c.user_id = p_user_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
```

***

## Core App Features & Pages

### Timeline View (`/timeline`)
Reverse-chronological feed of all Fieldy conversations with preview cards showing title, summary snippet, date, location (if captured), and auto-tags. Infinite scroll using Supabase pagination.

### Conversation Detail (`/conversations/[id]`)
Full transcript with speaker labels, AI summary, action items extracted as tasks, keywords, and an "Ask about this conversation" AI chat sidebar. Includes tagging UI and shareable link generation.

### Semantic Search (`/search`)
Natural language query box backed by the pgvector similarity search + hybrid full-text search (`tsvector` + `pgvector`). Results ranked by semantic similarity, with keyword highlighting.[^32]

### AI Recall Chat (`/chat`)
RAG-powered chat interface. User asks a question → system embeds the query → retrieves top matching conversations → constructs LLM prompt with context → streams response. Optionally wire in Fieldy's MCP endpoint for direct queries.[^33]

### Dashboard (`/`)
Summary metrics: conversations today/week/month, top people mentioned (from speaker profiles), most frequent keywords, task completion rate, calendar heatmap of conversation density.

### Tasks (`/tasks`)
Unified view of all action items synced from Fieldy, with status management (pending → done → dismissed). Filter by conversation, date, or keyword.

***

## Privacy & Security Considerations

Fieldy itself is HIPAA-compliant with end-to-end encryption, SOC 2 certified data centers (US and EU regions with your choice), and a no-data-selling policy. For your web app layer:[^2][^1]

- **API key hygiene:** Never commit `sk-fieldy-...` to source control. Store in Vercel environment variables only.
- **Webhook token validation:** Always verify the `token` query parameter on incoming webhook POSTs.[^34]
- **Supabase RLS:** Enable Row Level Security on all tables so each user's queries are scoped to their own `user_id`.[^35][^36]
- **Key rotation:** Revoke and rotate Fieldy API keys from Developer Settings if ever exposed.[^3]
- **Data minimization:** Fetch only the date ranges and fields needed for each query — Fieldy's own guidance on reducing PHI exposure.[^3]

***

## Augmenting Fieldy with Additional Lifelog Sources

Fieldy captures conversations. For a richer lifelog, consider these complementary connections:

| Source | Integration Method | Data Added |
|---|---|---|
| **Google Calendar** | Fieldy native + Google Calendar API | Meeting context, scheduling patterns |
| **Google Tasks** | Fieldy native | Auto-created action items |
| **Zapier / Make.com** | Fieldy webhook → Zapier | Fan-out to Notion, Sheets, Slack[^5] |
| **Apple Health / Whoop** | REST APIs | Sleep, HRV, activity alongside conversation logs |
| **Spotify / Last.fm** | REST API | Music listening context per time window |
| **Location (GPS)** | Fieldy captures location JSONB natively | Place-based memory clustering |

***

## Build Sequence

1. **Bootstrap** — `npx create-next-app@latest` (selects Next.js 16 + React 19.2 + Turbopack + Tailwind v4); then `npx supabase init` + `npx shadcn@latest init --style new-york`[^15][^37][^38][^10]
2. **Auth** — Supabase Auth (passkey/WebAuthn available in `@supabase/supabase-js@2.105+`); rename `middleware.ts` → `proxy.ts`; enable RLS on all tables[^16][^22]
3. **Webhook receiver** — Route Handler at `/api/webhooks/fieldy`; register URL in Fieldy Developer Settings[^5]
4. **Schema** — Deploy conversations/transcriptions/tasks/tags tables via Supabase migrations; use `extensions.vector(1536)` for the embedding column[^30][^18]
5. **pgvector** — Enable extension; create HNSW index `USING hnsw (embedding extensions.vector_cosine_ops)`[^18]
6. **Initial sync** — Server Action (Next.js 16 stable `"use server"`) to page through Fieldy REST API and backfill existing data[^21]
7. **Embedding pipeline** — Supabase Edge Function triggered on conversation insert; calls `text-embedding-3-small`; writes stringified vector to `embedding` column[^39][^19]
8. **Timeline UI** — React Server Component fetching paginated conversations; shadcn/ui Card + shadcn CLI v4 for fast component scaffolding[^13][^14]
9. **Search** — pgvector RPC function + hybrid full-text (`tsvector`); search input with debounced query[^40][^32]
10. **AI Chat** — Vercel AI SDK 5: `streamText()` in Route Handler + `useChat` from `@ai-sdk/react` on client; RAG context injected from pgvector results[^23][^24]
11. **Tasks view** — Status board synced from Fieldy `/tasks` endpoint; Supabase Realtime for live updates[^16]
12. **Deploy** — Push to GitHub; Vercel auto-deploys with Next.js 16 adapter; set env vars: `FIELDY_API_KEY`, `OPENAI_API_KEY`, `FIELDY_WEBHOOK_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

## References

1. [Fieldy is HIPAA-Compliant: AI Note-Taking You Can Trust with ...](https://www.fieldy.ai/blog/fieldy-is-hipaa-compliant-ai-note-taking-you-can-trust-with-confidential-data) - Fieldy is a HIPAA-compliant AI note-taking wearable that securely records, transcribes, and summariz...

2. [AI Note Taker FAQ — Frequently Asked Questions - Fieldy](https://www.fieldy.ai/faq) - Find answers to common questions about Fieldy — the wearable AI note taker. Learn about features, pr...

3. [Connecting Fieldy to Claude, ChatGPT, and your own apps](https://intercom.help/fieldy/en/articles/15019124-connecting-fieldy-to-claude-chatgpt-and-your-own-apps) - Fieldy can now share your conversation data — summaries, transcripts, tasks, and more — with the AI ...

4. [Connecting Fieldy to Claude, ChatGPT, and your own apps - Intercom](https://intercom.help/Fieldy/en/articles/15019124-connecting-fieldy-to-claude-chatgpt-and-your-own-apps) - Fieldy can now share your conversation data — summaries, transcripts, tasks, and more — with the AI ...

5. [Webhooks for Developers | Fieldy Help Center - Intercom](https://intercom.help/Fieldy/en/articles/11186620-webhooks-for-developers) - Webhooks are a powerful feature that enables Fieldy to send data to external applications whenever s...

6. [Fieldy AI Review - The $90 Wearable That “Remembers” Your Day / Limitless Acquired by Meta](https://www.youtube.com/watch?v=dUIgJzE7Hmw) - Buy for $89 from Fieldy AI - https://fieldlabsinc.sjv.io/ACHAL

00:00 Intro
00:48 Disclosure
01:08 U...

7. [Fieldy - App Walkthrough - YouTube](https://www.youtube.com/watch?v=hC8B5xkNMY8) - In this walkthrough video, we'll guide you through getting started with Fieldy.ai — an AI-powered we...

8. [Next.js - endoflife.date](https://endoflife.date/nextjs) - Check end-of-life, release policy and support schedule for Next.js.

9. [Upgrading: Version 16](https://nextjs.org/docs/app/guides/upgrading/version-16)

10. [11 -- Devtools Mcp Server &...](https://www.priyam.tech/blog/everything-new-in-next-js-16-2-4-a-complete-feature-breakdown) - Next.js 16 is the most significant release since the App Router landed. Turbopack is now the default...

11. [Tailwind CSS End of Life (EOL) Dates and End of Support (EOS ...](https://eosl.date/eol/product/tailwind-css/) - Tailwind CSS end of life dates across 22 release cycles. Tailwind CSS 4.3.1 is the latest supported ...

12. [Tailwind CSS](https://endoflife.date/tailwind-css) - Check end-of-life, release policy and support schedule for Tailwind CSS.

13. [March 2026 - shadcn/cli v4](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4) - We're releasing version 4 of shadcn/cli. More capable, easier to use. Built for you and your coding ...

14. [shadcn/ui March 2026 Update: CLI v4, AI Agent Skills and Design ...](https://dev.to/codedthemes/shadcnui-march-2026-update-cli-v4-ai-agent-skills-and-design-system-presets-1gp1) - The shadcn/ui ecosystem has just taken a massive leap forward. The March 2026 release focuses on...

15. [GitHub - shadcn-ui/ui: A set of beautifully-designed, accessible components and a code distribution platform. Works with your favorite frameworks. Open Source. Open Code.](https://github.com/shadcn-ui/ui) - A set of beautifully-designed, accessible components and a code distribution platform. Works with yo...

16. [supabase-js/CHANGELOG.md at master - GitHub](https://github.com/supabase/supabase-js/blob/master/CHANGELOG.md) - An isomorphic Javascript client for Supabase. Query your Supabase database, subscribe to realtime ev...

17. [AI & Vectors | Supabase Docs](https://supabase.com/docs/guides/ai)

18. [pgvector: Embeddings and vector similarity](https://supabase.com/docs/guides/database/extensions/pgvector)

19. [OpenAI text-embedding-3-small | VIPS Learn](https://learn.engineering.vips.edu/ai-models/openai-text-embedding-3-small) - OpenAI text-embedding-3-small is a 1536-dim embedding model optimised for throughput — the cheap def...

20. [Deprecation notice: upcoming model shutdowns in 2026](https://community.openai.com/t/deprecation-notice-upcoming-model-shutdowns-in-2026/1379553) - This info has just been shared via email by OpenAI. It can also be accessed via the deprecations pag...

21. [Next.js Server Actions: The Complete Guide (2026) - MakerKit](https://makerkit.dev/blog/tutorials/nextjs-server-actions) - The complete 2026 guide to Next.js Server Actions: useActionState, validation with Zod, error handli...

22. [Next.js 16 Migration Guide: What Changed and What Broke](https://www.salmanizhar.com/blog/nextjs-16-migration-guide) - A practical Next.js 16 migration guide for real teams: the breaking changes that matter, what tends ...

23. [Build Real-Time AI Chat with Vercel AI SDK Streaming - byteiota](https://byteiota.com/build-real-time-ai-chat-with-vercel-ai-sdk-streaming/)

24. [Link To Headingtype-Safe...](https://vercel.com/blog/ai-sdk-5) - Introducing type-safe chat, agentic loop control, new specification, tool enhancements, speech gener...

25. [Releases around vercel/ai ai@5.0.176 on GitHub - NewReleases.io](https://newreleases.io/latest?start=dpm08j8)

26. [Models | OpenAI API](https://developers.openai.com/api/docs/models) - Explore all available models on the OpenAI Platform.

27. [April 2026 Platform Updates](https://infinitytechstack.uk/openai-academy/2026-critical-updates/april-2026-platform-updates)

28. [GPT-5 vs GPT-4.1 - choosing the right model for your use case](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/model-choice-guide) - OpenAI's GPT-4.1 is a far better option. GPT-4.1 is optimized for high-speed, high-throughput. Ideal...

29. [GPT-5.5 & GPT-5.4 on Foundry | The 2026 Releases: MAI Labs ...](https://infinitytechstack.uk/azure-foundry/the-2026-releases-mai-labs-gpt-5-4-gpt-5-5/gpt-5-5-gpt-5-4-on-foundry)

30. [Similarity search with pgvector and Supabase](https://swizec.com/blog/similarity-search-with-pgvector-and-supabase/) - Explore the power of pgvector and Supabase for efficient similarity search in this comprehensive gui...

31. [Next.js 16 App Router: The Complete Guide for 2026 - Craftly](https://getcraftly.dev/blog/nextjs-16-app-router-guide) - Everything you need to know about Next.js 16 App Router — from server components to the new params A...

32. [Hybrid search | Supabase Docs](https://supabase.com/docs/guides/ai/hybrid-search)

33. [Retrieval Augmented Generation (RAG) and Semantic ...](https://help.openai.com/en/articles/8868588-retrieval-augmented-generation-rag-and-semantic-search-for-gpts) - Learn about RAG and how it is useful to GPT builders

34. [How to Automate Your Entire Life with Fieldy AI and OpenClaw ...](https://www.fieldy.ai/blog/fieldy-ai-webhook-moltbot-clawdbot-guide) - Automate your entire life: Connect Fieldy AI to OpenClaw (Clawdbot) in minutes. Webhook integration ...

35. [GitHub - TodoONada/nextjs-supabase-rls](https://github.com/TodoONada/nextjs-supabase-rls) - Contribute to TodoONada/nextjs-supabase-rls development by creating an account on GitHub.

36. [Building a Scalable FullStack Application with Next.js and Supabase: A Step-by-Step Guide](https://medium.com/@abhijeet11ray/building-a-scalable-fullstack-application-with-next-js-and-supabase-a-step-by-step-guide-297a1cd57474) - 1. Understanding the Tech Stack

37. [February 2026 - Unified Radix UI Package - Shadcn UI](https://ui.shadcn.com/docs/changelog/2026-02-radix-ui) - The new-york style now uses the unified radix-ui package.

38. [Next.js 16.2](https://nextjs.org/blog/next-16-2)

39. [Usage](https://supabase.com/docs/guides/ai/automatic-embeddings)

40. [Semantic Search | Supabase Docs](https://supabase.com/docs/guides/functions/examples/semantic-search)

