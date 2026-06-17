import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECALL_MAX_QUERY_LENGTH,
  normalizeRecallQuery,
  searchSemanticRecall,
} from "../lib/lifelog/semantic-recall.ts";

test("normalizeRecallQuery trims and caps query text", () => {
  assert.equal(normalizeRecallQuery("  budget  "), "budget");
  assert.equal(normalizeRecallQuery("budget\n\nplanning\tcall"), "budget planning call");
  assert.equal(normalizeRecallQuery("x".repeat(1000)).length, RECALL_MAX_QUERY_LENGTH);
});

test("searchSemanticRecall embeds query and calls match_conversations RPC", async () => {
  const calls: unknown[] = [];
  const supabase = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({
        data: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            title: "Budget",
            summary: "Planning",
            started_at: "2026-06-17T15:00:00.000Z",
            ended_at: null,
            keywords: ["budget"],
            similarity: 0.82,
          },
        ],
        error: null,
      });
    },
  };

  const result = await searchSemanticRecall({
    supabase: supabase as never,
    query: "budget planning",
    embedText: async (input) => {
      assert.equal(input, "budget planning");
      return [0.1, 0.2, 0.3];
    },
  });

  assert.deepEqual(calls, [
    {
      name: "match_conversations",
      args: {
        query_embedding: [0.1, 0.2, 0.3],
        match_count: 10,
        match_threshold: 0.7,
      },
    },
  ]);
  assert.equal(result.query, "budget planning");
  assert.equal(result.results[0]?.title, "Budget");
  assert.equal(result.results[0]?.similarity, 0.82);
});

test("searchSemanticRecall passes custom match options", async () => {
  const calls: unknown[] = [];
  const supabase = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({ data: [], error: null });
    },
  };

  await searchSemanticRecall({
    supabase: supabase as never,
    query: "  budget\nplanning  ",
    matchCount: 5,
    matchThreshold: 0.66,
    embedText: async (input) => {
      assert.equal(input, "budget planning");
      return [0.1, 0.2, 0.3];
    },
  });

  assert.deepEqual(calls, [
    {
      name: "match_conversations",
      args: {
        query_embedding: [0.1, 0.2, 0.3],
        match_count: 5,
        match_threshold: 0.66,
      },
    },
  ]);
});

test("searchSemanticRecall maps nullable or malformed rows safely", async () => {
  const supabase = {
    rpc() {
      return Promise.resolve({
        data: [
          null,
          {
            id: "00000000-0000-4000-8000-000000000001",
            title: null,
            summary: "",
            started_at: null,
            ended_at: 42,
            keywords: ["budget", null, "planning"],
            similarity: Number.NaN,
          },
        ],
        error: null,
      });
    },
  };

  const result = await searchSemanticRecall({
    supabase: supabase as never,
    query: "budget",
    embedText: async () => [0.1, 0.2, 0.3],
  });

  assert.deepEqual(result.results, [
    {
      id: "",
      title: "Untitled conversation",
      summary: "No summary available yet.",
      startedAt: null,
      endedAt: null,
      keywords: [],
      similarity: 0,
    },
    {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Untitled conversation",
      summary: "No summary available yet.",
      startedAt: null,
      endedAt: null,
      keywords: ["budget", "planning"],
      similarity: 0,
    },
  ]);
});

test("searchSemanticRecall does not embed blank queries", async () => {
  const result = await searchSemanticRecall({
    supabase: { rpc: () => Promise.reject(new Error("should not search")) } as never,
    query: "   ",
    embedText: async () => {
      throw new Error("should not embed blank query");
    },
  });

  assert.deepEqual(result, { query: "", results: [] });
});

test("searchSemanticRecall propagates RPC errors", async () => {
  const rpcError = new Error("rpc failed");

  await assert.rejects(
    () =>
      searchSemanticRecall({
        supabase: {
          rpc: () => Promise.resolve({ data: null, error: rpcError }),
        } as never,
        query: "budget",
        embedText: async () => [0.1, 0.2, 0.3],
      }),
    rpcError,
  );
});
