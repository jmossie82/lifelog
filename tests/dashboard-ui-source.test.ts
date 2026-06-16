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
