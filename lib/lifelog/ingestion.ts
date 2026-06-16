import type { SupabaseClient } from "@supabase/supabase-js";

import { deriveFieldySegmentId, deriveFieldyTaskId } from "./idempotency.ts";
import type {
  FieldyConversation,
  FieldyTask,
  FieldyTranscription,
} from "../fieldy/types.ts";
import type { Database, Json } from "../supabase/types.ts";

export type IngestionSupabase = Pick<
  SupabaseClient<Database, "public", Database["public"]>,
  "from"
>;

export type ConversationSet = {
  conversation: FieldyConversation;
  transcriptions?: FieldyTranscription[];
  tasks?: FieldyTask[];
};

export type IngestionOptions = {
  supabase: IngestionSupabase;
  ownerUserId: string;
};

type ConversationInsert = Database["public"]["Tables"]["conversations"]["Insert"];
type TranscriptionInsert = Database["public"]["Tables"]["transcriptions"]["Insert"];
type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function toIsoFromOffset(
  baseIso: string | null | undefined,
  offsetSeconds: number | null | undefined,
): string | null {
  if (!baseIso || offsetSeconds === null || offsetSeconds === undefined) {
    return null;
  }

  const baseMs = new Date(baseIso).getTime();
  if (Number.isNaN(baseMs) || !Number.isFinite(offsetSeconds)) {
    return null;
  }

  return new Date(baseMs + offsetSeconds * 1000).toISOString();
}

function conversationMetadata(conversation: FieldyConversation): Json {
  return {
    type: conversation.type ?? null,
    templateId: conversation.templateId ?? null,
    updatedAt: conversation.updatedAt ?? null,
  };
}

function taskMetadata(task: FieldyTask): Json {
  return {
    memoryId: task.memoryId ?? null,
    completionDate: task.completionDate ?? null,
    cancellationDate: task.cancellationDate ?? null,
  };
}

export function normalizeConversation({
  ownerUserId,
  conversation,
}: {
  ownerUserId: string;
  conversation: FieldyConversation;
}): ConversationInsert {
  return {
    user_id: ownerUserId,
    fieldy_id: conversation.id,
    title: conversation.title ?? null,
    summary: conversation.summary ?? null,
    content: conversation.content ?? null,
    keywords: conversation.keywords ?? [],
    started_at: toIsoOrNull(conversation.startTime),
    ended_at: toIsoOrNull(conversation.endTime),
    fieldy_metadata: conversationMetadata(conversation),
  };
}

export function createIngestionService({
  supabase,
  ownerUserId,
}: IngestionOptions) {
  async function ingestConversationSet({
    conversation,
    transcriptions = [],
    tasks = [],
  }: ConversationSet) {
    const { data: savedConversation, error: conversationError } = await supabase
      .from("conversations")
      .upsert(normalizeConversation({ ownerUserId, conversation }), {
        onConflict: "user_id,fieldy_id",
      })
      .select()
      .single();

    if (conversationError) {
      throw conversationError;
    }

    if (!savedConversation) {
      throw new Error("Conversation upsert returned no row");
    }

    const transcriptionRows: TranscriptionInsert[] = transcriptions.map((segment) => ({
      user_id: ownerUserId,
      conversation_id: savedConversation.id,
      fieldy_segment_id: deriveFieldySegmentId(conversation.id, segment),
      speaker_label: segment.speaker ?? null,
      text: segment.text,
      started_at:
        toIsoOrNull(segment.timestamp) ??
        toIsoFromOffset(conversation.startTime, segment.start),
      ended_at: toIsoFromOffset(conversation.startTime, segment.end),
    }));

    if (transcriptionRows.length > 0) {
      const { error } = await supabase.from("transcriptions").upsert(transcriptionRows, {
        onConflict: "user_id,fieldy_segment_id",
      });

      if (error) {
        throw error;
      }
    }

    const taskRows: TaskInsert[] = tasks.map((task) => ({
      user_id: ownerUserId,
      conversation_id: task.memoryId === conversation.id ? savedConversation.id : null,
      fieldy_task_id: deriveFieldyTaskId(conversation.id, task),
      title: task.title,
      status: task.status,
      due_at: toIsoOrNull(task.date),
      fieldy_metadata: taskMetadata(task),
    }));

    if (taskRows.length > 0) {
      const { error } = await supabase.from("tasks").upsert(taskRows, {
        onConflict: "user_id,fieldy_task_id",
      });

      if (error) {
        throw error;
      }
    }

    return {
      conversationCount: 1,
      transcriptionCount: transcriptionRows.length,
      taskCount: taskRows.length,
    };
  }

  return {
    ingestConversationSet,
  };
}
