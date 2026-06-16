import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/api/webhooks/fieldy/route.ts", "utf8");
const reconciliationSource = readFileSync(
  "lib/fieldy/webhook-reconciliation.ts",
  "utf8",
);

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
  assert.match(source, /selectMatchingConversationSets/);
  assert.match(source, /ingestConversationSet/);
});

test("webhook reconciliation matches text by hardened containment", () => {
  assert.match(reconciliationSource, /FULL_TRANSCRIPT_MIN_LENGTH/);
  assert.match(reconciliationSource, /SEGMENT_MIN_LENGTH/);
  assert.match(reconciliationSource, /SINGLE_SEGMENT_MIN_LENGTH/);
  assert.match(reconciliationSource, /canonicalText\.includes\(webhookText\)/);
  assert.match(reconciliationSource, /matchingSegments\.length >=/);
  assert.match(reconciliationSource, /selectMatchingConversationSets/);
});

test("webhook route records sync runs without raw transcript error text", () => {
  assert.match(source, /source: "webhook"/);
  assert.match(source, /error_message/);
  assert.doesNotMatch(source, /errorMessage:\s*validation\.payload/);
  assert.doesNotMatch(source, /validation\.payload\.transcription/);
});

test("webhook route catches setup failures without requiring a sync run", () => {
  assert.match(source, /let syncRunId: string \| null = null/);
  assert.match(
    source,
    /try \{\s*const \{ fieldyApiKey, fieldyWebhookSecret \} = getFieldyEnv\(\)/s,
  );
  assert.match(source, /if \(supabase && syncRunId\)/);
  assert.match(source, /\{ accepted: false, error: "Fieldy webhook reconciliation failed" \}/);
});

test("webhook route fails safely when multiple candidates match", () => {
  assert.match(source, /matchingSets\.length > 1/);
  assert.match(source, /Multiple canonical Fieldy conversations matched webhook text/);
  assert.doesNotMatch(source, /validation\.payload\.transcription/);
});
