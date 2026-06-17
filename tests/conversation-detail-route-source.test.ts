import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/conversations/[id]/page.tsx", "utf8");

test("conversation detail route uses async params and authenticated reads", () => {
  assert.match(source, /params:\s*Promise<\{ id: string \}>/);
  assert.match(
    source,
    /searchParams:\s*Promise<Record<string, string \| string\[\] \| undefined>>/,
  );
  assert.match(source, /await params/);
  assert.match(source, /await searchParams/);
  assert.match(source, /createSupabaseServerClient/);
  assert.doesNotMatch(source, /createSupabaseAdminClient/);
});

test("conversation detail route validates UUIDs and uses notFound for misses", () => {
  assert.match(source, /isUuid/);
  assert.match(source, /buildConversationBackHref/);
  assert.match(source, /notFound\(\)/);
  assert.match(source, /getConversationDetail/);
});

test("conversation detail route guards malformed timestamps before formatting", () => {
  assert.match(source, /const parsed = new Date\(value\)/);
  assert.match(source, /Number\.isFinite\(parsed\.getTime\(\)\)/);
  assert.match(source, /Invalid time/);
  assert.match(source, /\.format\(parsed\)/);
});
