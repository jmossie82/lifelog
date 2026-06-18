import type { UIMessage } from "ai";

import type { Json } from "@/lib/supabase/types";

export const RECALL_CHAT_SESSION_TITLE_LENGTH = 60;
export const RECALL_CHAT_MESSAGE_TEXT_LENGTH = 1000;
export const RECALL_CHAT_MAX_STORED_MESSAGES = 40;
export const RECALL_CHAT_MAX_SESSIONS = 20;

type RecallChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  parts: Json;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Short natural-language prompts can remain untruncated; titles above this threshold
// are clipped to the exported 60-character storage/display length.
const RECALL_CHAT_SESSION_TITLE_SOFT_TRUNCATE_THRESHOLD = 80;

export function normalizeRecallChatSessionId(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function createRecallChatSessionTitle(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return "New Recall chat";
  if (normalized.length <= RECALL_CHAT_SESSION_TITLE_SOFT_TRUNCATE_THRESHOLD) return normalized;
  return `${normalized.slice(0, RECALL_CHAT_SESSION_TITLE_LENGTH - 3)}...`;
}

export function serializeRecallChatMessageParts(parts: unknown) {
  if (!Array.isArray(parts)) return [];

  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => ({
      type: "text" as const,
      text: normalizeText(part.text).slice(0, RECALL_CHAT_MESSAGE_TEXT_LENGTH),
    }))
    .filter((part) => part.text.length > 0);
}

export function mapRecallChatMessageRow(row: RecallChatMessageRow): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: serializeRecallChatMessageParts(row.parts),
  };
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
