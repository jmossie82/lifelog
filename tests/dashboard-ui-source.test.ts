import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("components/lifelog-dashboard.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

test("dashboard distinguishes imported-empty from filtered-empty timeline states", () => {
  assert.match(source, /const hasImportedConversations = data\.importedConversationCount > 0/);
  assert.match(source, /!hasImportedConversations \? \(/);
  assert.match(source, /No Fieldy conversations imported yet/);
  assert.match(source, /No matching conversations/);
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
  assert.match(source, /displayTimeZone/);
  assert.match(source, /renderedAt/);
  assert.match(source, /timeZone: displayTimeZone/);
  assert.doesNotMatch(source, /const currentDate = new Date\(\);/);
  assert.doesNotMatch(source, /toDateString\(\)/);
  assert.doesNotMatch(source, /setDate\(/);
  assert.doesNotMatch(source, /getDate\(/);
});

test("dashboard uses safe mapped sync errors", () => {
  assert.match(source, /data\.lastSyncDisplay\?\.displayError/);
  assert.doesNotMatch(source, /data\.lastSync\?\.error_message/);
});

test("dashboard links conversation rows to detail routes with current query", () => {
  assert.match(source, /href=\{conversation\.href\}/);
  assert.match(source, /\/conversations\/\$\{conversation\.id\}/);
  assert.match(source, /from/);
});

test("dashboard uses URL-backed search and filter controls", () => {
  assert.match(source, /useRouter/);
  assert.match(source, /usePathname/);
  assert.match(source, /URLSearchParams/);
  assert.match(source, /name="q"/);
  assert.match(source, /data\.query\.q/);
  assert.match(source, /key=\{data\.query\.q\}/);
  assert.match(source, /key === "type" \|\| key === "range"/);
  assert.match(source, /value:\s*"conversation"/);
  assert.match(source, /navigateWith\(\{ type: tab\.value, page: "1" \}\)/);
  assert.doesNotMatch(source, /data-query/);
  assert.doesNotMatch(source, /useState<ConversationFilterTab>\("All"\)/);
});

test("dashboard renders sync activity panel with action state", () => {
  assert.match(source, /useActionState/);
  assert.match(source, /initialBackfillActionState/);
  assert.match(source, /lastSyncDisplay/);
  assert.match(source, /sync-activity-panel/);
});

test("dashboard exposes semantic recall search and embedding action", () => {
  assert.match(source, /embedConversations/);
  assert.match(source, /initialEmbedConversationsActionState/);
  assert.match(source, /name="recall"/);
  assert.match(source, /aria-label="Semantic recall search"/);
  assert.match(source, /Semantic recall/);
  assert.match(source, /similarity/);
  assert.match(source, /Embed conversations/);
});

test("dashboard preserves semantic recall in URL navigation and detail links", () => {
  assert.match(source, /if \(semanticRecall\.query\) params\.set\("recall", semanticRecall\.query\)/);
  assert.match(source, /navigateWith\(\{ recall: recall \|\| null \}\)/);
  assert.match(
    source,
    /href=\{`\/conversations\/\$\{result\.id\}\$\{[\s\S]*from=\$\{encodeURIComponent\(currentFromQuery\)\}/,
  );
});

test("dashboard distinguishes active-filter empty results from imported-empty results", () => {
  assert.match(source, /hasActiveFilters/);
  assert.match(source, /const hasImportedConversations = data\.importedConversationCount > 0/);
  assert.match(source, /!hasImportedConversations \? \(/);
  assert.match(source, /hasImportedConversations && hasActiveFilters && !hasFilteredConversations/);
  assert.doesNotMatch(source, /data\.conversations\.length === 0 && !hasActiveFilters/);
});

test("dashboard links conversations and preserves from query", () => {
  assert.match(source, /href=\{conversation\.href\}/);
  assert.match(source, /\/conversations\/\$\{conversation\.id\}/);
  assert.match(source, /from/);
  assert.match(
    source,
    /href: `\/conversations\/\$\{conversation\.id\}\$\{[\s\S]*currentFromQuery[\s\S]*encodeURIComponent\(currentFromQuery\)/,
  );
});

test("dashboard conversation row link is a focusable grid box", () => {
  assert.match(styles, /\.conversation-row\s*\{\s*padding: 0;/);
  assert.match(styles, /\.conversation-link\s*\{[\s\S]*display: grid;/);
  assert.match(styles, /\.conversation-link:focus-visible\s*\{[\s\S]*outline: 2px solid var\(--green\);/);
  assert.doesNotMatch(styles, /\.conversation-link\s*\{[\s\S]*display: contents;/);
});

test("dashboard responsive CSS keeps mobile search and collapsed sync action usable", () => {
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.sync-button span\s*\{[\s\S]*display: none;/);
  assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*\.sync-button\s*\{[\s\S]*width: 42px;/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.search-command\s*\{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\);/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.search-command button\s*\{[\s\S]*grid-column: 1 \/ -1;/);
  assert.doesNotMatch(styles, /device-card|device-render|range-button|search-command span/);
});
