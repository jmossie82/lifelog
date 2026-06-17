import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("components/lifelog-dashboard.tsx", "utf8");

test("dashboard distinguishes imported-empty from filtered-empty timeline states", () => {
  assert.match(source, /data\.conversations\.length === 0/);
  assert.match(source, /No Fieldy conversations imported yet/);
  assert.match(source, /No items in this view yet/);
  assert.doesNotMatch(
    source,
    /visibleConversations\.length === 0 \? \(\s*<section className="empty-state">/,
  );
});

test("dashboard uses mapped persisted conversation type for timeline filters", () => {
  assert.match(source, /type:\s*conversation\.type/);
  assert.doesNotMatch(source, /type:\s*"conversation"/);
});

test("dashboard memoizes imported conversation aggregates", () => {
  assert.match(
    source,
    /todayConversationCount,\s*keywordRows,\s*keywordCount,\s*keywordMax[\s\S]*useMemo/,
  );
  assert.match(source, /\}, \[conversations, data\.conversations\]\)/);
});

test("dashboard uses deterministic timezone-aware dates for hydration", () => {
  assert.match(source, /DISPLAY_TIME_ZONE = "America\/Chicago"/);
  assert.match(source, /renderedAt/);
  assert.match(source, /timeZone: DISPLAY_TIME_ZONE/);
  assert.doesNotMatch(source, /const currentDate = new Date\(\);/);
  assert.doesNotMatch(source, /toDateString\(\)/);
  assert.doesNotMatch(source, /setDate\(/);
  assert.doesNotMatch(source, /getDate\(/);
});
