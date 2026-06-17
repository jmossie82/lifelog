import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildConversationBackHref,
  readFirstSearchParam,
} from "../lib/lifelog/conversation-detail-route.ts";

test("readFirstSearchParam reads the first duplicate value", () => {
  assert.equal(readFirstSearchParam(["?q=first", "?q=second"]), "?q=first");
});

test("buildConversationBackHref preserves only dashboard query params", () => {
  assert.equal(
    buildConversationBackHref({
      from: "?q=budget&type=note&range=week&page=2&recall=planning&evil=https://example.com",
    }),
    "/?q=budget&type=note&range=week&page=2&recall=planning",
  );
});

test("buildConversationBackHref uses the first duplicate from value", () => {
  assert.equal(
    buildConversationBackHref({ from: ["?q=first", "?q=second"] }),
    "/?q=first",
  );
});

test("buildConversationBackHref rejects foreign absolute from values", () => {
  assert.equal(
    buildConversationBackHref({ from: "https://evil.test/?q=x" }),
    "/",
  );
});

test("buildConversationBackHref returns root for empty or unknown-only queries", () => {
  assert.equal(buildConversationBackHref({ from: "" }), "/");
  assert.equal(buildConversationBackHref({ from: "?evil=https://example.com" }), "/");
});
