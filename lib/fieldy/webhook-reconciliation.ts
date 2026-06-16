import type {
  FieldyConversation,
  FieldyTranscription,
  FieldyWebhookPayload,
} from "@/lib/fieldy/types";

const RECONCILIATION_WINDOW_MINUTES = 30;
const FULL_TRANSCRIPT_MIN_LENGTH = 40;
const SEGMENT_MIN_LENGTH = 12;
const SINGLE_SEGMENT_MIN_LENGTH = 40;
const MULTI_SEGMENT_REQUIRED_MATCHES = 2;

export type FieldyConversationSetCandidate = {
  conversation: FieldyConversation;
  transcriptions: FieldyTranscription[];
};

type TranscriptionRange = {
  startTime: string;
  endTime: string;
};

type MatchedConversationSafety =
  | {
      ok: true;
      transcriptionRange: TranscriptionRange;
    }
  | {
      ok: false;
      errorMessage:
        | "Matched Fieldy conversation did not include bounded times"
        | "Multiple Fieldy conversation intervals overlapped webhook match";
    };

export function buildWindow(date: string) {
  const webhookDate = new Date(date);
  const webhookTime = webhookDate.getTime();

  if (Number.isNaN(webhookTime)) {
    throw new Error("Invalid Fieldy webhook date");
  }

  const windowMs = RECONCILIATION_WINDOW_MINUTES * 60 * 1000;

  return {
    startTime: new Date(webhookTime - windowMs).toISOString(),
    endTime: new Date(webhookTime + windowMs).toISOString(),
  };
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchesWebhookPayload(
  payload: FieldyWebhookPayload,
  transcriptions: FieldyTranscription[],
) {
  const canonicalText = normalizeText(
    transcriptions.map((transcription) => transcription.text).join(" "),
  );
  const webhookText = normalizeText(payload.transcription);

  if (webhookText && canonicalText === webhookText) {
    return true;
  }

  if (
    webhookText.length >= FULL_TRANSCRIPT_MIN_LENGTH &&
    canonicalText.includes(webhookText)
  ) {
    return true;
  }

  const eligibleSegments = Array.from(
    new Set(
      payload.transcriptions
        .map((segment) => normalizeText(segment.text))
        .filter((segment) => segment.length >= SEGMENT_MIN_LENGTH),
    ),
  );

  if (eligibleSegments.length === 0) {
    return false;
  }

  const matchingSegments = eligibleSegments.filter((segment) =>
    canonicalText.includes(segment),
  );

  if (eligibleSegments.some((segment) => canonicalText === segment)) {
    return true;
  }

  if (eligibleSegments.length === 1) {
    return (
      eligibleSegments[0].length >= SINGLE_SEGMENT_MIN_LENGTH &&
      matchingSegments.length === 1
    );
  }

  return matchingSegments.length >= MULTI_SEGMENT_REQUIRED_MATCHES;
}

export function getBoundedConversationRange(
  conversation: FieldyConversation,
): TranscriptionRange | null {
  if (!conversation.startTime || !conversation.endTime) {
    return null;
  }

  const startTime = new Date(conversation.startTime);
  const endTime = new Date(conversation.endTime);

  if (
    Number.isNaN(startTime.getTime()) ||
    Number.isNaN(endTime.getTime()) ||
    startTime.getTime() >= endTime.getTime()
  ) {
    return null;
  }

  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };
}

function rangesOverlap(left: TranscriptionRange, right: TranscriptionRange) {
  return left.startTime < right.endTime && right.startTime < left.endTime;
}

export function assessMatchedConversationSafety(
  matched: FieldyConversationSetCandidate,
  candidates: FieldyConversationSetCandidate[],
): MatchedConversationSafety {
  const matchedRange = getBoundedConversationRange(matched.conversation);

  if (!matchedRange) {
    return {
      ok: false,
      errorMessage: "Matched Fieldy conversation did not include bounded times",
    };
  }

  const overlappingCandidateCount = candidates.filter((candidate) => {
    const candidateRange = getBoundedConversationRange(candidate.conversation);
    return candidateRange && rangesOverlap(matchedRange, candidateRange);
  }).length;

  if (overlappingCandidateCount > 1) {
    return {
      ok: false,
      errorMessage: "Multiple Fieldy conversation intervals overlapped webhook match",
    };
  }

  return {
    ok: true,
    transcriptionRange: matchedRange,
  };
}

export function selectMatchingConversationSets(
  payload: FieldyWebhookPayload,
  candidates: FieldyConversationSetCandidate[],
) {
  return candidates.filter((candidate) =>
    matchesWebhookPayload(payload, candidate.transcriptions),
  );
}
