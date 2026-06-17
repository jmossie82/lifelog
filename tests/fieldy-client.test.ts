import assert from "node:assert/strict";
import { test } from "node:test";

import { FieldyApiError, createFieldyClient } from "../lib/fieldy/client.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, init);
}

test("fetchConversations pages through nextCursor with date bounds and mode", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl = async (url: string) => {
    requestedUrls.push(url);
    if (requestedUrls.length === 1) {
      return jsonResponse({
        items: [{ id: "first" }],
        nextCursor: "next-page",
      });
    }

    return jsonResponse({
      items: [{ id: "second" }],
      nextCursor: null,
    });
  };
  const client = createFieldyClient({ apiKey: "test-key", fetchImpl });

  const items = await client.fetchConversations({
    startTime: "2026-06-16T12:00:00.000Z",
    endTime: "2026-06-17T12:00:00.000Z",
    mode: "intersects-range",
  });

  assert.deepEqual(
    items.map((item) => item.id),
    ["first", "second"],
  );
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0] ?? "", /\/conversations\?/);
  assert.match(requestedUrls[0] ?? "", /startTime=2026-06-16T12%3A00%3A00.000Z/);
  assert.equal(new URL(requestedUrls[0] ?? "").searchParams.get("endTime"), "2026-06-17T12:00:00.000Z");
  assert.equal(new URL(requestedUrls[0] ?? "").searchParams.get("pageSize"), "50");
  assert.equal(new URL(requestedUrls[0] ?? "").searchParams.get("mode"), "intersects-range");
  assert.equal(new URL(requestedUrls[0] ?? "").searchParams.has("cursor"), false);
  assert.equal(new URL(requestedUrls[1] ?? "").searchParams.get("cursor"), "next-page");
});

test("fetchTranscriptions uses pageSize and date range params", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl = async (url: string) => {
    requestedUrls.push(url);
    return jsonResponse({
      items: [{ id: "transcription-1", text: "Hello" }],
      nextCursor: null,
    });
  };
  const client = createFieldyClient({ apiKey: "test-key", fetchImpl });

  const items = await client.fetchTranscriptions({
    startTime: "2026-06-16T12:00:00.000Z",
    endTime: "2026-06-16T13:00:00.000Z",
  });

  assert.deepEqual(items, [{ id: "transcription-1", text: "Hello" }]);
  assert.equal(requestedUrls.length, 1);
  const params = new URL(requestedUrls[0] ?? "").searchParams;
  assert.equal(params.get("startTime"), "2026-06-16T12:00:00.000Z");
  assert.equal(params.get("endTime"), "2026-06-16T13:00:00.000Z");
  assert.equal(params.get("pageSize"), "1000");
});

test("fetchTasks requests each documented status", async () => {
  const requestedStatuses: string[] = [];
  const fetchImpl = async (url: string) => {
    const status = new URL(url).searchParams.get("status");
    assert.ok(status);
    requestedStatuses.push(status);
    return jsonResponse({
      items: [{ title: `${status} task`, status }],
    });
  };
  const client = createFieldyClient({ apiKey: "test-key", fetchImpl });

  const tasks = await client.fetchTasks();

  assert.deepEqual(requestedStatuses, [
    "new",
    "approved",
    "completed",
    "rejected",
    "skipped",
    "cancelled",
    "expired",
  ]);
  assert.equal(tasks.length, 7);
  assert.equal(tasks.some((task) => task.status === "completed"), true);
  assert.equal(tasks.some((task) => task.status === "expired"), true);
});

test("fetchTasks pages through nextCursor for each status", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl = async (url: string) => {
    requestedUrls.push(url);
    const parsedUrl = new URL(url);
    const status = parsedUrl.searchParams.get("status");
    const cursor = parsedUrl.searchParams.get("cursor");

    if (status === "new" && !cursor) {
      return jsonResponse({
        items: [{ id: "new-1", title: "first", status }],
        nextCursor: "new-next",
      });
    }

    if (status === "new" && cursor === "new-next") {
      return jsonResponse({
        items: [{ id: "new-2", title: "second", status }],
        nextCursor: null,
      });
    }

    return jsonResponse({
      items: [],
      nextCursor: null,
    });
  };
  const client = createFieldyClient({ apiKey: "test-key", fetchImpl });

  const tasks = await client.fetchTasks();

  assert.deepEqual(
    tasks.map((task) => task.id),
    ["new-1", "new-2"],
  );
  assert.equal(
    requestedUrls.some((url) => new URL(url).searchParams.get("cursor") === "new-next"),
    true,
  );
});

test("non-429 failures throw FieldyApiError with status", async () => {
  const fetchImpl = async () => jsonResponse({ error: "nope" }, { status: 500 });
  const client = createFieldyClient({ apiKey: "test-key", fetchImpl });

  await assert.rejects(
    () => client.fetchTranscriptions({ startTime: "2026-06-16T12:00:00.000Z" }),
    (error) => {
      assert.equal(error instanceof FieldyApiError, true);
      assert.equal((error as FieldyApiError).status, 500);
      return true;
    },
  );
});

test("one 429 response is retried before succeeding", async () => {
  const requestedUrls: string[] = [];
  const fetchImpl = async (url: string) => {
    requestedUrls.push(url);
    if (requestedUrls.length === 1) {
      return jsonResponse(
        { error: "rate limited" },
        {
          status: 429,
          headers: {
            "retry-after": "0",
          },
        },
      );
    }

    return jsonResponse({
      items: [{ id: "retry-success", text: "Hello again" }],
      nextCursor: null,
    });
  };
  const client = createFieldyClient({
    apiKey: "test-key",
    fetchImpl,
    fallbackRetryDelayMs: 0,
  });

  const items = await client.fetchTranscriptions({ startTime: "2026-06-16T12:00:00.000Z" });

  assert.deepEqual(items, [{ id: "retry-success", text: "Hello again" }]);
  assert.equal(requestedUrls.length, 2);
});

test("absent empty invalid or negative retry-after uses the fallback retry delay before retrying", async () => {
  const cases: Array<{ name: string; headers?: HeadersInit }> = [
    { name: "absent" },
    { name: "empty", headers: { "retry-after": "" } },
    { name: "invalid", headers: { "retry-after": "not-a-number" } },
    { name: "negative", headers: { "retry-after": "-1" } },
  ];

  for (const retryAfterCase of cases) {
    const requestedUrls: string[] = [];
    const requestedDelays: number[] = [];
    const fetchImpl = async (url: string) => {
      requestedUrls.push(url);
      if (requestedUrls.length === 1) {
        return jsonResponse(
          { error: "rate limited" },
          {
            status: 429,
            headers: retryAfterCase.headers,
          },
        );
      }

      return jsonResponse({
        items: [{ id: `${retryAfterCase.name}-fallback-delay-success`, text: "Delayed hello" }],
        nextCursor: null,
      });
    };
    const client = createFieldyClient({
      apiKey: "test-key",
      fetchImpl,
      fallbackRetryDelayMs: 25,
      sleepImpl: async (delayMs) => {
        requestedDelays.push(delayMs);
      },
    });

    const items = await client.fetchTranscriptions({ startTime: "2026-06-16T12:00:00.000Z" });

    assert.deepEqual(items, [{ id: `${retryAfterCase.name}-fallback-delay-success`, text: "Delayed hello" }]);
    assert.deepEqual(requestedDelays, [25], retryAfterCase.name);
    assert.equal(requestedUrls.length, 2);
  }
});
