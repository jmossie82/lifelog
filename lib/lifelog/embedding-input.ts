import { createHash } from "node:crypto";

export const CONVERSATION_EMBEDDING_INPUT_VERSION = 1;
// This is a privacy/cost guard, not a tokenizer. The OpenAI client still
// rejects empty input and owns request-level API validation.
export const CONVERSATION_EMBEDDING_MAX_CHARS = 12_000;

export type ConversationEmbeddingInput = {
  id: string;
  fieldyId: string;
  title: string;
  summary: string;
  content: string | null;
  keywords: string[];
  transcript: Array<{
    speakerLabel: string | null;
    text: string;
    startedAt: string | null;
  }>;
};

function normalizeLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function pushLine(lines: string[], label: string, value: string | null | undefined) {
  const normalized = value ? normalizeLine(value) : "";

  if (normalized) {
    lines.push(`${label}: ${normalized}`);
  }
}

export function buildConversationEmbeddingInput(
  conversation: ConversationEmbeddingInput,
) {
  const lines: string[] = [];
  const speakerAliases = new Map<string, string>();

  pushLine(lines, "Title", conversation.title);
  pushLine(lines, "Summary", conversation.summary);

  const keywords = conversation.keywords.map(normalizeLine).filter(Boolean);
  if (keywords.length > 0) {
    lines.push(`Keywords: ${keywords.join(", ")}`);
  }

  pushLine(lines, "Content", conversation.content);

  const transcriptLines = conversation.transcript.flatMap((segment) => {
    const text = normalizeLine(segment.text);
    if (!text) {
      return [];
    }

    const speaker = getSpeakerAlias(segment.speakerLabel, speakerAliases);
    return [`${speaker || "Speaker"}: ${text}`];
  });

  if (transcriptLines.length > 0) {
    lines.push("Transcript:", ...transcriptLines);
  }

  return lines.join("\n").slice(0, CONVERSATION_EMBEDDING_MAX_CHARS);
}

function getSpeakerAlias(
  speakerLabel: string | null,
  speakerAliases: Map<string, string>,
) {
  const normalized = speakerLabel ? normalizeLine(speakerLabel) : "";
  if (!normalized) {
    return "Speaker";
  }

  const existingAlias = speakerAliases.get(normalized);
  if (existingAlias) {
    return existingAlias;
  }

  const alias = `Speaker ${speakerAliases.size + 1}`;
  speakerAliases.set(normalized, alias);
  return alias;
}

export function hashConversationEmbeddingInput({
  input,
  embeddingModel,
  inputVersion,
}: {
  input: string;
  embeddingModel: string;
  inputVersion: number;
}) {
  return createHash("sha256")
    .update(JSON.stringify({ input, embeddingModel, inputVersion }))
    .digest("hex");
}
