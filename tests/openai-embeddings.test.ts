import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOpenAiEmbeddingClient,
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL_DIMENSIONS,
} from "../lib/lifelog/openai-embeddings.ts";

const validEmbedding = Array.from(
  { length: OPENAI_EMBEDDING_DIMENSIONS },
  (_, index) => index / OPENAI_EMBEDDING_DIMENSIONS,
);
const validLargeEmbedding = Array.from(
  { length: OPENAI_EMBEDDING_MODEL_DIMENSIONS["text-embedding-3-large"] },
  (_, index) => index / OPENAI_EMBEDDING_MODEL_DIMENSIONS["text-embedding-3-large"],
);

test("createOpenAiEmbeddingClient posts sanitized embedding requests", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const client = createOpenAiEmbeddingClient({
    apiKey: "sk-test",
    embeddingModel: "text-embedding-3-small",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ data: [{ embedding: validEmbedding }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.deepEqual(await client.embedText("hello\nworld"), validEmbedding);
  assert.equal(requests[0]?.url, "https://api.openai.com/v1/embeddings");
  assert.equal(requests[0]?.init.method, "POST");
  assert.ok(requests[0]?.init.signal instanceof AbortSignal);
  assert.equal(
    (requests[0]?.init.headers as Record<string, string>).Authorization,
    "Bearer sk-test",
  );
  assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
    input: "hello world",
    model: "text-embedding-3-small",
  });
});

test("createOpenAiEmbeddingClient times out stalled embedding requests", async () => {
  const client = createOpenAiEmbeddingClient({
    apiKey: "sk-secret-value",
    embeddingModel: "text-embedding-3-small",
    timeoutMs: 1,
    fetch: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
        });
      }),
  });

  await assert.rejects(
    () => client.embedText("hello"),
    /OpenAI embedding request timed out/,
  );
});

test("createOpenAiEmbeddingClient times out stalled response bodies", async () => {
  const client = createOpenAiEmbeddingClient({
    apiKey: "sk-secret-value",
    embeddingModel: "text-embedding-3-small",
    timeoutMs: 1,
    fetch: async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            signal?.addEventListener("abort", () => {
              controller.error(Object.assign(new Error("request aborted"), { name: "AbortError" }));
            });
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  await assert.rejects(
    () => client.embedText("hello"),
    /OpenAI embedding request timed out/,
  );
});

test("createOpenAiEmbeddingClient rejects blank input before fetch", async () => {
  let fetchCount = 0;
  const client = createOpenAiEmbeddingClient({
    apiKey: "sk-test",
    embeddingModel: "text-embedding-3-small",
    fetch: async () => {
      fetchCount += 1;
      return new Response("{}");
    },
  });

  await assert.rejects(
    () => client.embedText(" \n\t "),
    /Embedding input must not be empty/,
  );
  assert.equal(fetchCount, 0);
});

test("createOpenAiEmbeddingClient validates embeddings by model dimensions", async () => {
  const client = createOpenAiEmbeddingClient({
    apiKey: "sk-test",
    embeddingModel: "text-embedding-3-large",
    fetch: async () =>
      new Response(JSON.stringify({ data: [{ embedding: validLargeEmbedding }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  assert.deepEqual(await client.embedText("hello"), validLargeEmbedding);
});

test("createOpenAiEmbeddingClient rejects unsupported models before fetch", async () => {
  let fetchCount = 0;

  assert.throws(
    () =>
      createOpenAiEmbeddingClient({
        apiKey: "sk-test",
        embeddingModel: "unsupported-embedding-model",
        fetch: async () => {
          fetchCount += 1;
          return new Response("{}");
        },
      }),
    /Unsupported OpenAI embedding model/,
  );
  assert.equal(fetchCount, 0);
});

test("createOpenAiEmbeddingClient throws non-secret errors", async () => {
  const client = createOpenAiEmbeddingClient({
    apiKey: "sk-secret-value",
    embeddingModel: "text-embedding-3-small",
    fetch: async () =>
      new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    () => client.embedText("hello"),
    /OpenAI embedding request failed with 429/,
  );
});

test("createOpenAiEmbeddingClient rejects malformed embedding responses", async () => {
  const malformedEmbedding = [...validEmbedding] as Array<number | string>;
  malformedEmbedding[12] = "bad";
  const client = createOpenAiEmbeddingClient({
    apiKey: "sk-test",
    embeddingModel: "text-embedding-3-small",
    fetch: async () =>
      new Response(JSON.stringify({ data: [{ embedding: malformedEmbedding }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(
    () => client.embedText("hello"),
    /OpenAI embedding response did not include an embedding/,
  );
});
