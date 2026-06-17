import {
  CONVERSATION_EMBEDDING_INPUT_VERSION,
  buildConversationEmbeddingInput,
  hashConversationEmbeddingInput,
} from "./embedding-input.ts";

export type ConversationEmbeddingRow = {
  id: string;
  user_id: string;
  fieldy_id: string;
  title: string | null;
  summary: string | null;
  content: string | null;
  keywords: string[] | null;
  embedding_input_hash: string | null;
};

export type TranscriptionEmbeddingRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  speaker_label: string | null;
  text: string;
  started_at: string | null;
};

export type QueryResult<TRow> = {
  data: TRow[] | null;
  error: unknown;
};

export type UpdateResult = {
  error: unknown;
};

export type SelectQuery<TRow> = {
  select(columns: string): SelectQuery<TRow>;
  eq(column: string, value: unknown): SelectQuery<TRow>;
  order(
    column: string,
    options: { ascending: boolean; nullsFirst: boolean },
  ): Promise<QueryResult<TRow>>;
};

export type UpdateQuery = {
  update(value: {
    embedding: string;
    embedding_model: string;
    embedding_input_hash: string;
    embedded_at: string;
    embedding_error: null;
  }): {
    match(value: { id: string; user_id: string }): Promise<UpdateResult>;
  };
};

export type ConversationEmbeddingSupabase = {
  from(table: "conversations"): SelectQuery<ConversationEmbeddingRow> & UpdateQuery;
  from(table: "transcriptions"): SelectQuery<TranscriptionEmbeddingRow>;
};

export async function embedMissingConversations({
  supabase,
  ownerUserId,
  embeddingModel,
  embedText,
  now = new Date(),
}: {
  supabase: ConversationEmbeddingSupabase;
  ownerUserId: string;
  embeddingModel: string;
  embedText: (input: string) => Promise<number[]>;
  now?: Date;
}) {
  const { data: conversations, error } = await supabase
    .from("conversations")
    .select(
      "id, user_id, fieldy_id, title, summary, content, keywords, embedding_input_hash",
    )
    .eq("user_id", ownerUserId)
    .order("started_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw error;
  }

  let embeddedCount = 0;
  let skippedCount = 0;

  for (const conversation of conversations ?? []) {
    const { data: transcriptions, error: transcriptionsError } = await supabase
      .from("transcriptions")
      .select("id, user_id, conversation_id, speaker_label, text, started_at")
      .eq("conversation_id", conversation.id)
      .eq("user_id", ownerUserId)
      .order("started_at", { ascending: true, nullsFirst: false });

    if (transcriptionsError) {
      throw transcriptionsError;
    }

    const input = buildConversationEmbeddingInput({
      id: conversation.id,
      fieldyId: conversation.fieldy_id,
      title: conversation.title ?? "",
      summary: conversation.summary ?? "",
      content: conversation.content,
      keywords: conversation.keywords ?? [],
      transcript: (transcriptions ?? []).map((transcription) => ({
        speakerLabel: transcription.speaker_label,
        text: transcription.text,
        startedAt: transcription.started_at,
      })),
    });

    if (!input) {
      skippedCount += 1;
      continue;
    }

    const inputHash = hashConversationEmbeddingInput({
      input,
      embeddingModel,
      inputVersion: CONVERSATION_EMBEDDING_INPUT_VERSION,
    });

    if (conversation.embedding_input_hash === inputHash) {
      skippedCount += 1;
      continue;
    }

    const embedding = await embedText(input);
    const { error: updateError } = await supabase
      .from("conversations")
      .update({
        embedding: JSON.stringify(embedding),
        embedding_model: embeddingModel,
        embedding_input_hash: inputHash,
        embedded_at: now.toISOString(),
        embedding_error: null,
      })
      .match({ id: conversation.id, user_id: ownerUserId });

    if (updateError) {
      throw updateError;
    }

    embeddedCount += 1;
  }

  return { embeddedCount, skippedCount };
}
