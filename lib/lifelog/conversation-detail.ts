import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/types";

const CONVERSATION_DETAIL_TYPES = [
  "conversation",
  "note",
  "task",
  "mention",
] as const;

export type ConversationDetailType = (typeof CONVERSATION_DETAIL_TYPES)[number];

type ConversationDetailRow = Pick<
  Database["public"]["Tables"]["conversations"]["Row"],
  | "id"
  | "fieldy_id"
  | "title"
  | "summary"
  | "content"
  | "started_at"
  | "ended_at"
  | "keywords"
  | "fieldy_metadata"
>;

type TranscriptionDetailRow = Pick<
  Database["public"]["Tables"]["transcriptions"]["Row"],
  "id" | "speaker_label" | "text" | "started_at" | "ended_at"
>;

type TaskDetailRow = Pick<
  Database["public"]["Tables"]["tasks"]["Row"],
  "id" | "title" | "status" | "due_at"
>;

type QueryResult<TData> = {
  data: TData;
  error: unknown;
};

export type ConversationDetail = {
  id: string;
  fieldyId: string;
  title: string;
  summary: string;
  content: string | null;
  startedAt: string | null;
  endedAt: string | null;
  keywords: string[];
  type: ConversationDetailType;
  transcript: Array<{
    id: string;
    speakerLabel: string | null;
    text: string;
    startedAt: string | null;
    endedAt: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueAt: string | null;
  }>;
};

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function mapConversationDetail({
  conversation,
  transcriptions,
  tasks,
}: {
  conversation: ConversationDetailRow;
  transcriptions: TranscriptionDetailRow[];
  tasks: TaskDetailRow[];
}): ConversationDetail {
  return {
    id: conversation.id,
    fieldyId: conversation.fieldy_id,
    title: conversation.title ?? "Untitled conversation",
    summary: conversation.summary ?? "No summary available yet.",
    content: conversation.content,
    startedAt: conversation.started_at,
    endedAt: conversation.ended_at,
    keywords: conversation.keywords,
    type: mapFieldyConversationType(conversation.fieldy_metadata),
    transcript: [...transcriptions]
      .sort(compareTranscriptRows)
      .map((transcription) => ({
        id: transcription.id,
        speakerLabel: transcription.speaker_label,
        text: transcription.text,
        startedAt: transcription.started_at,
        endedAt: transcription.ended_at,
      })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.due_at,
    })),
  };
}

export async function getConversationDetail(
  supabase: SupabaseClient<Database>,
  id: string,
  userId: string,
): Promise<ConversationDetail | null> {
  const conversationResult = (await supabase
    .from("conversations")
    .select(
      "id, fieldy_id, title, summary, content, started_at, ended_at, keywords, fieldy_metadata",
    )
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()) as QueryResult<ConversationDetailRow | null>;

  if (conversationResult.error) {
    throw conversationResult.error;
  }

  if (!conversationResult.data) {
    return null;
  }

  const [transcriptionsResult, tasksResult] = (await Promise.all([
    supabase
      .from("transcriptions")
      .select("id, speaker_label, text, started_at, ended_at")
      .eq("conversation_id", conversationResult.data.id)
      .eq("user_id", userId)
      .order("started_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true }),
    supabase
      .from("tasks")
      .select("id, title, status, due_at")
      .eq("conversation_id", conversationResult.data.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ])) as [
    QueryResult<TranscriptionDetailRow[] | null>,
    QueryResult<TaskDetailRow[] | null>,
  ];

  if (transcriptionsResult.error) {
    throw transcriptionsResult.error;
  }

  if (tasksResult.error) {
    throw tasksResult.error;
  }

  return mapConversationDetail({
    conversation: conversationResult.data,
    transcriptions: transcriptionsResult.data ?? [],
    tasks: tasksResult.data ?? [],
  });
}

function compareTranscriptRows(
  first: TranscriptionDetailRow,
  second: TranscriptionDetailRow,
) {
  const firstTime = getSortableTime(first.started_at);
  const secondTime = getSortableTime(second.started_at);

  if (firstTime !== secondTime) {
    return firstTime - secondTime;
  }

  return first.id.localeCompare(second.id);
}

function getSortableTime(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function mapFieldyConversationType(fieldyMetadata: Json): ConversationDetailType {
  if (
    !fieldyMetadata ||
    Array.isArray(fieldyMetadata) ||
    typeof fieldyMetadata !== "object"
  ) {
    return "conversation";
  }

  const fieldyType = fieldyMetadata.type;
  if (typeof fieldyType !== "string") {
    return "conversation";
  }

  return CONVERSATION_DETAIL_TYPES.includes(fieldyType as ConversationDetailType)
    ? (fieldyType as ConversationDetailType)
    : "conversation";
}
