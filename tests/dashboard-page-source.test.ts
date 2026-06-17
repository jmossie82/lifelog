import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/page.tsx", "utf8");

test("dashboard page awaits Next 16 search params and normalizes dashboard query", () => {
  assert.match(source, /searchParams:\s*Promise<Record<string, string \| string\[\] \| undefined>>/);
  assert.match(source, /await searchParams/);
  assert.match(source, /normalizeDashboardQuery/);
});

test("dashboard page passes normalized query and display timezone to getDashboardData", () => {
  assert.match(source, /getDisplayTimeZone\(\)/);
  assert.match(source, /getDashboardData\(supabase,\s*\{/);
  assert.match(source, /query: dashboardQuery/);
  assert.match(source, /displayTimeZone/);
});
