import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  DEFAULT_DISPLAY_TIME_ZONE,
  DEFAULT_RECALL_ANSWER_MODEL,
  getOpenAiEmbeddingEnv,
  getOpenAiRecallEnv,
  getClientEnv,
  getDisplayTimeZone,
  getFieldyEnv,
  getFieldyWebhookSecret,
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

test("getFieldyWebhookSecret reads only the webhook secret", () => {
  delete process.env.FIELDY_API_KEY;
  process.env.FIELDY_BACKFILL_DAYS = "not-a-number";
  process.env.FIELDY_WEBHOOK_SECRET = "secret";

  assert.equal(getFieldyWebhookSecret(), "secret");
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

test("getFieldyEnv rejects partially numeric FIELDY_BACKFILL_DAYS", () => {
  process.env.FIELDY_API_KEY = "sk-fieldy-example";
  process.env.FIELDY_WEBHOOK_SECRET = "secret";
  process.env.FIELDY_BACKFILL_DAYS = "10abc";

  assert.throws(
    () => getFieldyEnv(),
    /FIELDY_BACKFILL_DAYS must be a positive integer/,
  );
});

test("getOwnerUserId returns the configured owner user id", () => {
  process.env.LIFELOG_OWNER_USER_ID = "00000000-0000-4000-8000-000000000001";

  assert.equal(getOwnerUserId(), "00000000-0000-4000-8000-000000000001");
});

test("getDisplayTimeZone defaults to the app display timezone", () => {
  delete process.env.LIFELOG_DISPLAY_TIME_ZONE;

  assert.equal(getDisplayTimeZone(), DEFAULT_DISPLAY_TIME_ZONE);
});

test("getDisplayTimeZone accepts a configured IANA timezone", () => {
  process.env.LIFELOG_DISPLAY_TIME_ZONE = "America/Los_Angeles";

  assert.equal(getDisplayTimeZone(), "America/Los_Angeles");
});

test("getDisplayTimeZone rejects invalid timezone values", () => {
  process.env.LIFELOG_DISPLAY_TIME_ZONE = "not-a-timezone";

  assert.throws(
    () => getDisplayTimeZone(),
    /LIFELOG_DISPLAY_TIME_ZONE must be a valid IANA time zone/,
  );
});

test("getOpenAiEmbeddingEnv returns server-only embedding settings", () => {
  process.env.OPENAI_API_KEY = "sk-test-openai";
  delete process.env.LIFELOG_EMBEDDING_MODEL;

  assert.deepEqual(getOpenAiEmbeddingEnv(), {
    openAiApiKey: "sk-test-openai",
    embeddingModel: "text-embedding-3-small",
  });

  process.env.LIFELOG_EMBEDDING_MODEL = "text-embedding-3-small";

  assert.equal(getOpenAiEmbeddingEnv().embeddingModel, "text-embedding-3-small");
});

test("getOpenAiEmbeddingEnv rejects unsupported embedding models", () => {
  process.env.OPENAI_API_KEY = "sk-test-openai";
  process.env.LIFELOG_EMBEDDING_MODEL = "text-embedding-3-large";

  assert.throws(
    () => getOpenAiEmbeddingEnv(),
    /LIFELOG_EMBEDDING_MODEL must be text-embedding-3-small/,
  );
});

test("getOpenAiRecallEnv returns server-only recall answer settings", () => {
  process.env.OPENAI_API_KEY = "sk-test-openai";
  delete process.env.LIFELOG_RECALL_ANSWER_MODEL;

  assert.deepEqual(getOpenAiRecallEnv(), {
    openAiApiKey: "sk-test-openai",
    recallAnswerModel: DEFAULT_RECALL_ANSWER_MODEL,
  });

  process.env.LIFELOG_RECALL_ANSWER_MODEL = "gpt-5.5-mini";

  assert.equal(getOpenAiRecallEnv().recallAnswerModel, "gpt-5.5-mini");
});
