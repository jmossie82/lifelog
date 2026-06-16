import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assessMatchedConversationSafety,
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

function conversation(
  id: string,
  times: Pick<FieldyConversation, "startTime" | "endTime"> = {
    startTime: "2026-06-16T12:00:00.000Z",
    endTime: "2026-06-16T12:10:00.000Z",
  },
): FieldyConversation {
  return { id, ...times };
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

test("does not match a short common top-level transcript by itself", () => {
  const webhook = payload({
    transcription: "thank you very much",
    segments: ["thank you very much"],
  });

  assert.equal(
    matchesWebhookPayload(
      webhook,
      transcriptions(["Great, thank you very much. I will follow up later."]),
    ),
    false,
  );
});

test("matches exact short full transcript equality", () => {
  const webhook = payload({
    transcription: "Hi, my name is Adam.",
    segments: ["Hi, my name is Adam."],
  });

  assert.equal(
    matchesWebhookPayload(webhook, transcriptions(["Hi, my name is Adam."])),
    true,
  );
});

test("matches exact short segment equality", () => {
  const webhook = payload({
    transcription: "",
    segments: ["Hi, my name is Adam."],
  });

  assert.equal(
    matchesWebhookPayload(webhook, transcriptions(["Hi, my name is Adam."])),
    true,
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

test("rejects matched conversations without bounded times", () => {
  const matched = {
    conversation: conversation("conversation-a", {
      startTime: "2026-06-16T12:00:00.000Z",
      endTime: null,
    }),
    transcriptions: transcriptions(["Hi, my name is Adam."]),
  };

  assert.deepEqual(assessMatchedConversationSafety(matched, [matched]), {
    ok: false,
    errorMessage: "Matched Fieldy conversation did not include bounded times",
  });
});

test("rejects matched conversations with overlapping candidate intervals", () => {
  const matched = {
    conversation: conversation("conversation-a", {
      startTime: "2026-06-16T12:00:00.000Z",
      endTime: "2026-06-16T12:10:00.000Z",
    }),
    transcriptions: transcriptions(["Hi, my name is Adam."]),
  };
  const overlapping = {
    conversation: conversation("conversation-b", {
      startTime: "2026-06-16T12:05:00.000Z",
      endTime: "2026-06-16T12:15:00.000Z",
    }),
    transcriptions: transcriptions(["Unrelated nearby conversation."]),
  };

  assert.deepEqual(
    assessMatchedConversationSafety(matched, [matched, overlapping]),
    {
      ok: false,
      errorMessage: "Multiple Fieldy conversation intervals overlapped webhook match",
    },
  );
});

test("returns matched bounded transcription range when interval is unambiguous", () => {
  const matched = {
    conversation: conversation("conversation-a", {
      startTime: "2026-06-16T12:00:00.000Z",
      endTime: "2026-06-16T12:10:00.000Z",
    }),
    transcriptions: transcriptions(["Hi, my name is Adam."]),
  };
  const separate = {
    conversation: conversation("conversation-b", {
      startTime: "2026-06-16T12:11:00.000Z",
      endTime: "2026-06-16T12:20:00.000Z",
    }),
    transcriptions: transcriptions(["Unrelated nearby conversation."]),
  };

  assert.deepEqual(assessMatchedConversationSafety(matched, [matched, separate]), {
    ok: true,
    transcriptionRange: {
      startTime: "2026-06-16T12:00:00.000Z",
      endTime: "2026-06-16T12:10:00.000Z",
    },
  });
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
