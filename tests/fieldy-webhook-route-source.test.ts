import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/api/webhooks/fieldy/route.ts", "utf8");

test("webhook route uses FIELDY_WEBHOOK_SECRET and documented validation", () => {
  assert.match(source, /fieldyWebhookSecret/);
  assert.match(source, /validateFieldyWebhookPayload/);
  assert.doesNotMatch(source, /FIELDY_WEBHOOK_TOKEN/);
  assert.doesNotMatch(source, /conversation\.processed/);
});

test("webhook route reconciles with Fieldy REST before ingestion", () => {
  assert.match(source, /fetchConversations/);
  assert.match(source, /fetchTranscriptions/);
  assert.match(source, /mode: "intersects-range"/);
  assert.match(source, /matchesWebhookPayload/);
  assert.match(source, /ingestConversationSet/);
});

test("webhook route records sync runs without raw transcript error text", () => {
  assert.match(source, /source: "webhook"/);
  assert.match(source, /error_message/);
  assert.doesNotMatch(source, /errorMessage:\s*validation\.payload/);
  assert.doesNotMatch(source, /validation\.payload\.transcription/);
});
