# Repository Guidelines

## Project Structure & Module Organization

This private Next.js lifelog app integrates Fieldy and Supabase. Routes, layouts, and server actions live in `app/`; shared UI in `components/`; reusable code in `lib/`. Keep Fieldy clients and webhooks in `lib/fieldy/`, ingestion/dashboard logic in `lib/lifelog/`, Supabase helpers in `lib/supabase/`, migrations in `supabase/migrations/`, tests in `tests/*.test.ts`, and plans in `docs/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: start local development.
- `npm test`: run `tests/*.test.ts` with Node's test runner.
- `npm run lint`: run ESLint.
- `npm run build`: create a production build.
- `npm start`: serve the production build.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. Prefer named exports, colocate small private helpers near callers, and keep server-only code out of client components. Use the `@/*` alias for root imports and `.ts` extensions for local library imports when matching existing files. Name React components in PascalCase, functions/variables in camelCase, and database fields in snake_case. Let `npm run lint` be the style gate.

## Testing Guidelines

Tests use `node:test` with `node:assert/strict`. Add focused tests in `tests/` and name files after the behavior, such as `fieldy-webhook-validation.test.ts`. Cover idempotency, webhook validation, Supabase queries, auth boundaries, and env parsing when those areas change. Run `npm test`, `npm run lint`, and `npm run build` before handoff.

## Commit & Pull Request Guidelines

Recent commits use short imperative summaries, for example `Build Fieldy lifelog app scaffold`. Keep commits scoped and descriptive. Pull requests should explain behavior, list verification commands, link issues or plans, and include screenshots for dashboard or login UI changes. Call out migrations, environment changes, and security-sensitive behavior.

## Security & Configuration Tips

Keep `.env.local` local. Required keys include `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LIFELOG_OWNER_USER_ID`, `FIELDY_API_KEY`, `FIELDY_WEBHOOK_SECRET`, and `FIELDY_BACKFILL_DAYS`. Never expose server secrets with `NEXT_PUBLIC_`. Treat Fieldy payloads and lifelog data as private; avoid logging raw content, transcripts, API keys, or owner identifiers.

## Agent-Specific Instructions

Use Context7 MCP via `npx ctx7@latest` for current library, SDK, API, CLI, or cloud-service docs before setup, configuration, migration, or code-generation answers. Run `library` first unless given `/org/project`; use the full question, then `docs`, with at most three commands. Report quota errors, and rerun DNS/network failures outside the sandbox. Subagents are allowed; all completed code changes need a Context7-backed subagent review.
