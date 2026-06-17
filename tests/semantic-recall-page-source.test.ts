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
  const recallBranchStart = source.indexOf("if (recallQuery) {");
  const recallBranchEnd = source.indexOf("\n  }\n\n  return", recallBranchStart);
  const recallBranch = source.slice(recallBranchStart, recallBranchEnd);

  assert.ok(recallBranchStart > -1);
  assert.ok(recallBranchEnd > recallBranchStart);
  assert.match(recallBranch, /getOpenAiEmbeddingEnv\(\)/);
  assert.match(recallBranch, /createOpenAiEmbeddingClient/);
  assert.match(recallBranch, /searchSemanticRecall\(\{/);
});
