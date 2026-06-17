import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("app/page.tsx", "utf8");

test("dashboard page loads semantic recall results from authenticated server context", () => {
  assert.match(source, /searchSemanticRecall/);
  assert.match(source, /getOpenAiEmbeddingEnv/);
  assert.match(source, /createOpenAiEmbeddingClient/);
  assert.match(source, /recallQuery/);
  assert.match(source, /semanticRecall/);
  assert.doesNotMatch(source, /createSupabaseAdminClient/);
});

test("dashboard page only creates OpenAI embedding client for nonblank recall queries", () => {
  const recallBranchMatch = source.match(
    /if\s*\(recallQuery\)\s*\{[\s\S]*?\n\s*\}\s*\n\s*return/,
  );
  const recallBranch = recallBranchMatch?.[0] ?? "";

  assert.ok(recallBranch.length > 0);
  assert.match(recallBranch, /getOpenAiEmbeddingEnv\(\)/);
  assert.match(recallBranch, /createOpenAiEmbeddingClient/);
  assert.match(recallBranch, /searchSemanticRecall\(\{/);
  assert.match(recallBranch, /catch/);
  assert.match(recallBranch, /semanticRecall = \{ query: recallQuery, results: \[\] \}/);
});
