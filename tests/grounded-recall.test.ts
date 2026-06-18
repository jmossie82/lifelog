import assert from "node:assert/strict";
import { test } from "node:test";

import {
  answerGroundedRecall,
  buildGroundedRecallSources,
  GROUNDED_RECALL_MAX_SOURCES,
  type GroundedRecallModelAnswer,
} from "../lib/lifelog/grounded-recall.ts";
import type { SemanticRecallResult } from "../lib/lifelog/semantic-recall.ts";

const results: SemanticRecallResult[] = Array.from({ length: 8 }, (_, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  title: `Conversation ${index}`,
  summary: `Summary ${index}`,
  startedAt: "2026-06-17T15:00:00.000Z",
  endedAt: null,
  keywords: ["budget", "planning", "private", "lifelog"],
  similarity: 0.9 - index * 0.01,
}));

test("buildGroundedRecallSources caps sources and assigns stable citation ids", () => {
  const sources = buildGroundedRecallSources(results);

  assert.equal(sources.length, GROUNDED_RECALL_MAX_SOURCES);
  assert.deepEqual(
    sources.map((source) => source.citationId),
    ["S1", "S2", "S3", "S4", "S5"],
  );
  assert.equal(sources[0]?.conversationId, results[0]?.id);
});

test("answerGroundedRecall abstains without retrieved sources", async () => {
  const answer = await answerGroundedRecall({
    query: "budget",
    results: [],
    generateAnswer: async () => {
      throw new Error("should not generate without sources");
    },
  });

  assert.equal(answer.status, "insufficient_evidence");
  assert.deepEqual(answer.citations, []);
});

test("answerGroundedRecall validates model citations against provided sources", async () => {
  const seen: Array<{ query: string; sourceIds: string[] }> = [];
  const answer = await answerGroundedRecall({
    query: "  budget\nplanning  ",
    results,
    generateAnswer: async ({ query, sources }): Promise<GroundedRecallModelAnswer> => {
      seen.push({
        query,
        sourceIds: sources.map((source) => source.citationId),
      });
      return {
        status: "answered",
        answer: "You discussed budget planning in the retrieved conversations.",
        citationIds: ["S1", "S999", "S1", "S3"],
      };
    },
  });

  assert.deepEqual(seen, [
    {
      query: "budget planning",
      sourceIds: ["S1", "S2", "S3", "S4", "S5"],
    },
  ]);
  assert.equal(answer.status, "answered");
  assert.deepEqual(
    answer.citations.map((citation) => citation.citationId),
    ["S1", "S3"],
  );
});

test("answerGroundedRecall treats uncited answers as insufficient evidence", async () => {
  const answer = await answerGroundedRecall({
    query: "budget",
    results,
    generateAnswer: async () => ({
      status: "answered",
      answer: "A claim without a source.",
      citationIds: [],
    }),
  });

  assert.equal(answer.status, "insufficient_evidence");
  assert.deepEqual(answer.citations, []);
});

test("answerGroundedRecall preserves model abstentions", async () => {
  const answer = await answerGroundedRecall({
    query: "budget",
    results,
    generateAnswer: async () => ({
      status: "insufficient_evidence",
      answer: "I cannot answer from the retrieved entries.",
      citationIds: [],
    }),
  });

  assert.deepEqual(answer, {
    status: "insufficient_evidence",
    answer: "I cannot answer from the retrieved entries.",
    citations: [],
  });
});
