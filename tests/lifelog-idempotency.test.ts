import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveFieldySegmentId,
  deriveFieldyTaskId,
  hashStableValue,
} from "../lib/lifelog/idempotency.ts";

test("hashStableValue is stable for object key order", () => {
  assert.equal(
    hashStableValue({
      b: ["second", { z: true, a: null }],
      a: "first",
    }),
    hashStableValue({
      a: "first",
      b: ["second", { a: null, z: true }],
    }),
  );
});

test("deriveFieldySegmentId uses existing segment id when present", () => {
  assert.equal(
    deriveFieldySegmentId("conversation-1", {
      id: "segment-1",
      text: "Hello",
    }),
    "segment-1",
  );
});

test("deriveFieldySegmentId derives stable id without segment id", () => {
  const first = deriveFieldySegmentId("conversation-1", {
    text: "Launch check-in",
    speaker: "Alex",
    start: 12,
    end: 34,
    timestamp: "2026-06-16T15:00:00.000Z",
  });
  const second = deriveFieldySegmentId("conversation-1", {
    text: "Launch check-in",
    speaker: "Alex",
    start: 12,
    end: 34,
    timestamp: "2026-06-16T15:00:00.000Z",
  });

  assert.match(first, /^derived-segment-conversation-1-[a-f0-9]{24}$/);
  assert.equal(first, second);
});

test("deriveFieldyTaskId uses existing task id when present", () => {
  assert.equal(
    deriveFieldyTaskId("conversation-1", {
      id: "task-1",
      title: "Follow up",
      status: "new",
    }),
    "task-1",
  );
});

test("deriveFieldyTaskId derives stable id without task id", () => {
  const first = deriveFieldyTaskId("conversation-1", {
    title: "Send launch notes",
    date: "2026-06-17T15:00:00.000Z",
    status: "approved",
  });
  const second = deriveFieldyTaskId("conversation-1", {
    title: "Send launch notes",
    date: "2026-06-17T15:00:00.000Z",
    status: "approved",
  });

  assert.match(first, /^derived-task-conversation-1-[a-f0-9]{24}$/);
  assert.equal(first, second);
});
