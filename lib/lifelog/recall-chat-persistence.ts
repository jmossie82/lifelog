import type { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";

import type { Database, Json } from "@/lib/supabase/types";

import { GROUNDED_RECALL_MAX_SOURCES } from "./grounded-recall.ts";

export const RECALL_CHAT_SESSION_TITLE_LENGTH = 60;
export const RECALL_CHAT_MESSAGE_TEXT_LENGTH = 1000;
export const RECALL_CHAT_MAX_STORED_MESSAGES = 40;
export const RECALL_CHAT_MAX_SESSIONS = 20;

type RecallChatMessageRow = {
  id: string;
  role: "user" | "assistant";
  parts: Json;
};

export type LifelogSupabaseClient = SupabaseClient<Database>;

type RecallChatSessionRow = Database["public"]["Tables"]["recall_chat_sessions"]["Row"];
type RecallChatSessionSummaryRow = Omit<RecallChatSessionRow, "user_id">;

export type RecallChatSessionSummary = {
  id: string;
  title: string;
  latestUserText: string | null;
  sourceCount: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RecallChatSourceCitation = {
  citationId: string;
  conversationId: string;
  title: string;
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

export async function getRecallChatSessions(supabase: LifelogSupabaseClient, { userId }: { userId: string }) {
  const { data, error } = await supabase
    .from("recall_chat_sessions")
    .select("id, title, latest_user_text, source_count, message_count, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(RECALL_CHAT_MAX_SESSIONS);

  if (error) throw error;
  return (data ?? []).map(mapRecallChatSessionRow);
}

export async function getRecallChatMessages(
  supabase: LifelogSupabaseClient,
  { sessionId, userId }: { sessionId: string; userId: string },
) {
  const { data, error } = await supabase
    .from("recall_chat_messages")
    .select("id, role, parts, source_citations, created_at")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(RECALL_CHAT_MAX_STORED_MESSAGES);

  if (error) throw error;
  return (data ?? []).map((row) => mapRecallChatMessageRow(row as RecallChatMessageRow));
}

export async function ensureRecallChatSession(
  supabase: LifelogSupabaseClient,
  {
    latestUserText,
    sessionId,
    userId,
  }: {
    latestUserText: string;
    sessionId: string;
    userId: string;
  },
) {
  const storedLatestUserText = normalizeStoredText(latestUserText);
  const { data, error } = await supabase
    .from("recall_chat_sessions")
    .upsert(
      {
        id: sessionId,
        user_id: userId,
        title: createRecallChatSessionTitle(storedLatestUserText),
        latest_user_text: storedLatestUserText,
      },
      { onConflict: "user_id,id" },
    )
    .select("id, title, latest_user_text, source_count, message_count, created_at, updated_at")
    .single();

  if (error) throw error;
  return mapRecallChatSessionRow(data as RecallChatSessionRow);
}

export async function saveRecallChatTurn(
  supabase: LifelogSupabaseClient,
  {
    latestUserText,
    responseMessage,
    sessionId,
    sources,
    userId,
  }: {
    latestUserText: string;
    responseMessage: UIMessage;
    sessionId: string;
    sources: RecallChatSourceCitation[];
    userId: string;
  },
) {
  const storedLatestUserText = normalizeStoredText(latestUserText);
  const sourceCitations = serializeRecallChatSourceCitations(sources);
  const userMessage = {
    user_id: userId,
    session_id: sessionId,
    role: "user" as const,
    parts: [{ type: "text", text: storedLatestUserText }],
    source_citations: [],
  };
  const assistantMessage = {
    user_id: userId,
    session_id: sessionId,
    role: "assistant" as const,
    parts: serializeRecallChatMessageParts(responseMessage.parts),
    source_citations: sourceCitations,
  };

  const { error: insertError } = await supabase.from("recall_chat_messages").insert([userMessage, assistantMessage]);

  if (insertError) throw insertError;

  const { error: updateError } = await supabase.rpc("update_recall_chat_session_summary", {
    session_user_id: userId,
    chat_session_id: sessionId,
    latest_user_text_value: storedLatestUserText,
    source_count_value: sourceCitations.length,
    message_increment: 2,
  });

  if (updateError) throw updateError;
}

function mapRecallChatSessionRow(row: RecallChatSessionSummaryRow): RecallChatSessionSummary {
  return {
    id: row.id,
    title: row.title,
    latestUserText: row.latest_user_text,
    sourceCount: row.source_count,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeStoredText(value: string) {
  return normalizeText(value).slice(0, RECALL_CHAT_MESSAGE_TEXT_LENGTH);
}

function serializeRecallChatSourceCitations(sources: unknown): RecallChatSourceCitation[] {
  if (!Array.isArray(sources)) return [];

  return sources
    .map((source) => {
      const citationId = readBoundedSourceField(source, "citationId");
      const conversationId = readBoundedSourceField(source, "conversationId");
      const title = readBoundedSourceField(source, "title");

      if (!citationId || !conversationId || !title) return null;

      return { citationId, conversationId, title };
    })
    .filter((source): source is RecallChatSourceCitation => source !== null)
    .slice(0, GROUNDED_RECALL_MAX_SOURCES);
}

function readBoundedSourceField(source: unknown, key: keyof RecallChatSourceCitation) {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Partial<Record<keyof RecallChatSourceCitation, unknown>>)[key];
  if (typeof value !== "string") return null;
  const normalized = normalizeStoredText(value);
  return normalized.length > 0 ? normalized : null;
}
