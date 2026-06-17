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

test("rejects unsupported or incomplete Fieldy transcription webhook payloads", () => {
  assert.deepEqual(validateFieldyWebhookPayload({ type: "conversation.processed" }), {
    ok: false,
    status: 422,
    error: "Unsupported or incomplete Fieldy webhook payload",
  });

  assert.deepEqual(
    validateFieldyWebhookPayload({
      date: "2026-06-16T12:00:00.000Z",
      transcription: "Hello from Fieldy.",
      transcriptions: [
        {
          text: "Hello from Fieldy.",
          speaker: "A",
          start: 0.04,
          end: 4.4,
        },
      ],
    }),
    {
      ok: false,
      status: 422,
      error: "Unsupported or incomplete Fieldy webhook payload",
    },
  );
});

test("rejects unparseable webhook dates", () => {
  assert.deepEqual(
    validateFieldyWebhookPayload({
      date: "not-a-date",
      transcription: "Hello from Fieldy.",
      transcriptions: [
        {
          text: "Hello from Fieldy.",
          speaker: "A",
          start: 0.04,
          end: 4.4,
          duration: 4.36,
        },
      ],
    }),
    {
      ok: false,
      status: 422,
      error: "Unsupported or incomplete Fieldy webhook payload",
    },
  );
});

test("accepts completed transcription webhook payloads", () => {
  const result = validateFieldyWebhookPayload({
    date: "2026-06-16T12:00:00.000Z",
    transcription: "Hello from Fieldy.",
    transcriptions: [
      {
        text: "Hello from Fieldy.",
        speaker: "A",
        start: 0.04,
        end: 4.4,
        duration: 4.36,
      },
    ],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.transcriptions[0]?.speaker, "A");
  }
});
