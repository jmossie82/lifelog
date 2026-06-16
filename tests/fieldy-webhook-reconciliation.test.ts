import assert from "node:assert/strict";
import { test } from "node:test";

import {
  matchesWebhookPayload,
  selectMatchingConversationSets,
} from "../lib/fieldy/webhook-reconciliation.ts";
import type {
  FieldyConversation,
  FieldyTranscription,
  FieldyWebhookPayload,
} from "../lib/fieldy/types.ts";

function payload({
  transcription,
  segments,
}: {
  transcription: string;
  segments: string[];
}): FieldyWebhookPayload {
  return {
    date: "2026-06-16T12:00:00.000Z",
    transcription,
    transcriptions: segments.map((text, index) => ({
      text,
      speaker: "Speaker 1",
      start: index,
      end: index + 1,
      duration: 1,
    })),
  };
}

function transcriptions(texts: string[]): FieldyTranscription[] {
  return texts.map((text, index) => ({
    id: `segment-${index}`,
    text,
  }));
}

function conversation(id: string): FieldyConversation {
  return { id, startTime: "2026-06-16T12:00:00.000Z" };
}

test("matches full webhook transcript contained in canonical text with nearby segments", () => {
  const webhook = payload({
    transcription: "Need to call April about the router refresh.",
    segments: ["Need to call April about the router refresh."],
  });

  assert.equal(
    matchesWebhookPayload(
      webhook,
      transcriptions([
        "Small talk before the useful part.",
        "Need to call April about the router refresh.",
        "Extra nearby REST segment after the webhook.",
      ]),
    ),
    true,
  );
});

test("does not match a single short common segment", () => {
  const webhook = payload({
    transcription: "",
    segments: ["okay"],
  });

  assert.equal(
    matchesWebhookPayload(
      webhook,
      transcriptions(["Okay, I can do that after lunch."]),
    ),
    false,
  );
});

test("matches empty top-level transcript with enough eligible segment evidence", () => {
  const webhook = payload({
    transcription: "",
    segments: [
      "Confirm the replacement modem shipped today.",
      "Schedule the follow up installation window.",
    ],
  });

  assert.equal(
    matchesWebhookPayload(
      webhook,
      transcriptions([
        "Confirm the replacement modem shipped today.",
        "Schedule the follow up installation window.",
      ]),
    ),
    true,
  );
});

test("selects multiple matching candidate conversations for ambiguity handling", () => {
  const webhook = payload({
    transcription: "Please document the backup battery replacement.",
    segments: ["Please document the backup battery replacement."],
  });

  const matches = selectMatchingConversationSets(webhook, [
    {
      conversation: conversation("conversation-a"),
      transcriptions: transcriptions([
        "Please document the backup battery replacement.",
      ]),
    },
    {
      conversation: conversation("conversation-b"),
      transcriptions: transcriptions([
        "Extra intro. Please document the backup battery replacement.",
      ]),
    },
  ]);

  assert.deepEqual(
    matches.map((match) => match.conversation.id),
    ["conversation-a", "conversation-b"],
  );
});
