import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  getClientEnv,
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
