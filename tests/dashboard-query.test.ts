import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DASHBOARD_CONVERSATION_FILTER_TYPES,
  DASHBOARD_MAX_SEARCH_LENGTH,
  DASHBOARD_MAX_PAGE,
  DASHBOARD_PAGE_SIZE,
  DASHBOARD_RANGE_FILTERS,
  buildConversationSearchFilter,
  getDashboardRangeBounds,
  normalizeDashboardQuery,
} from "../lib/lifelog/dashboard-query.ts";

test("normalizeDashboardQuery defaults invalid params", () => {
  const query = normalizeDashboardQuery({
    q: ["  transcript  "],
    type: "invalid",
    range: "later",
    page: "-10",
  });

  assert.deepEqual(query, {
    q: "transcript",
    type: "all",
    range: "all",
    page: 1,
  });
});

test("normalizeDashboardQuery accepts known filters and caps page", () => {
  const query = normalizeDashboardQuery({
    q: "  fieldy ".repeat(80),
    type: "mention",
    range: "week",
    page: String(DASHBOARD_MAX_PAGE + 100),
  });

  assert.equal(query.q.length, 200);
  assert.equal(query.type, "mention");
  assert.equal(query.range, "week");
  assert.equal(query.page, DASHBOARD_MAX_PAGE);
});

test("dashboard constants define a bounded cumulative page size", () => {
  assert.equal(DASHBOARD_PAGE_SIZE, 25);
  assert.equal(DASHBOARD_MAX_PAGE, 20);
  assert.equal(DASHBOARD_MAX_SEARCH_LENGTH, 200);
});

test("dashboard filters expose expected public values", () => {
  assert.deepEqual(DASHBOARD_CONVERSATION_FILTER_TYPES, [
    "all",
    "conversation",
    "note",
    "task",
    "mention",
  ]);
  assert.deepEqual(DASHBOARD_RANGE_FILTERS, ["all", "today", "week"]);
});

test("buildConversationSearchFilter returns null for empty search", () => {
  assert.equal(buildConversationSearchFilter(""), null);
  assert.equal(buildConversationSearchFilter("   "), null);
});

test("buildConversationSearchFilter strips PostgREST grammar characters and LIKE wildcards", () => {
  const filter = buildConversationSearchFilter(
    String.raw`Meeting, owner.id:(abc)%_ * "quoted" \ path`,
  );

  assert.equal(
    filter,
    "title.ilike.*Meeting owner id abc quoted path*,summary.ilike.*Meeting owner id abc quoted path*,content.ilike.*Meeting owner id abc quoted path*",
  );
});

test("buildConversationSearchFilter returns null when input has only filter grammar", () => {
  assert.equal(buildConversationSearchFilter(String.raw`,.:()"\\%_*`), null);
});

test("buildConversationSearchFilter caps very long input", () => {
  const filter = buildConversationSearchFilter("a".repeat(250));
  const firstClause = filter?.split(",")[0] ?? "";

  assert.ok(firstClause.length < 230);
  assert.match(firstClause, /^title\.ilike\.\*a+\*$/);
});

test("getDashboardRangeBounds returns null for all range", () => {
  assert.equal(
    getDashboardRangeBounds({
      range: "all",
      displayTimeZone: "America/Chicago",
      now: new Date("2026-06-17T15:30:00.000Z"),
    }),
    null,
  );
});

test("getDashboardRangeBounds calculates today in the display timezone", () => {
  assert.deepEqual(
    getDashboardRangeBounds({
      range: "today",
      displayTimeZone: "America/Chicago",
      now: new Date("2026-06-17T15:30:00.000Z"),
    }),
    {
      startedAtGte: "2026-06-17T05:00:00.000Z",
      startedAtLt: "2026-06-18T05:00:00.000Z",
    },
  );
});

test("getDashboardRangeBounds calculates spring-forward today bounds in the display timezone", () => {
  assert.deepEqual(
    getDashboardRangeBounds({
      range: "today",
      displayTimeZone: "America/Chicago",
      now: new Date("2026-03-08T18:00:00.000Z"),
    }),
    {
      startedAtGte: "2026-03-08T06:00:00.000Z",
      startedAtLt: "2026-03-09T05:00:00.000Z",
    },
  );
});

test("getDashboardRangeBounds calculates fall-back today bounds in the display timezone", () => {
  assert.deepEqual(
    getDashboardRangeBounds({
      range: "today",
      displayTimeZone: "America/Chicago",
      now: new Date("2026-11-01T18:00:00.000Z"),
    }),
    {
      startedAtGte: "2026-11-01T05:00:00.000Z",
      startedAtLt: "2026-11-02T06:00:00.000Z",
    },
  );
});

test("getDashboardRangeBounds calculates rolling week ending at render time", () => {
  assert.deepEqual(
    getDashboardRangeBounds({
      range: "week",
      displayTimeZone: "America/Chicago",
      now: new Date("2026-06-17T15:30:00.000Z"),
    }),
    {
      startedAtGte: "2026-06-10T15:30:00.000Z",
      startedAtLt: "2026-06-17T15:30:00.001Z",
    },
  );
});
