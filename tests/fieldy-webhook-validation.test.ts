import assert from "node:assert/strict";
import { test } from "node:test";

import { validateFieldyWebhookPayload } from "../lib/fieldy/webhook-validation.ts";

test("rejects valid JSON that is not an object", () => {
  assert.deepEqual(validateFieldyWebhookPayload(null), {
    ok: false,
    status: 400,
    error: "JSON payload must be an object",
  });

  assert.deepEqual(validateFieldyWebhookPayload([]), {
    ok: false,
    status: 400,
    error: "JSON payload must be an object",
  });
});

test("rejects unsupported or incomplete Fieldy events", () => {
  assert.deepEqual(validateFieldyWebhookPayload({ type: "ping" }), {
    ok: false,
    status: 422,
    error: "Unsupported or incomplete Fieldy event",
  });

  assert.deepEqual(
    validateFieldyWebhookPayload({
      type: "conversation.processed",
      conversation: {},
    }),
    {
      ok: false,
      status: 422,
      error: "Unsupported or incomplete Fieldy event",
    },
  );
});

test("accepts processed conversation events with a Fieldy id", () => {
  const result = validateFieldyWebhookPayload({
    type: "conversation.processed",
    conversation: {
      id: "fieldy-conversation-123",
      title: "Product Standup",
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.conversation.id, "fieldy-conversation-123");
  }
});
