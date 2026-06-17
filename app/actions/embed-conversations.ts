"use server";

import { revalidatePath } from "next/cache";

import { getOpenAiEmbeddingEnv, getOwnerUserId } from "@/lib/env";
import {
  embedMissingConversations,
  type ConversationEmbeddingSupabase,
} from "@/lib/lifelog/conversation-embeddings";
import type { EmbedConversationsActionState } from "@/lib/lifelog/embed-action-state";
import { createOpenAiEmbeddingClient } from "@/lib/lifelog/openai-embeddings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function embedConversations(
  _previousState: EmbedConversationsActionState,
  _formData: FormData,
): Promise<EmbedConversationsActionState> {
  void _previousState;
  void _formData;

  const serverSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();
  const ownerUserId = getOwnerUserId();

  if (!user || user.id !== ownerUserId) {
    return {
      status: "error",
      message: "Only the lifelog owner can embed conversations.",
      embeddedCount: null,
      skippedCount: null,
    };
  }

  try {
    const { openAiApiKey, embeddingModel } = getOpenAiEmbeddingEnv();
    const openAi = createOpenAiEmbeddingClient({
      apiKey: openAiApiKey,
      embeddingModel,
    });
    const supabase = createSupabaseAdminClient() as unknown as ConversationEmbeddingSupabase;
    const result = await embedMissingConversations({
      supabase,
      ownerUserId,
      embeddingModel,
      embedText: openAi.embedText,
    });

    revalidatePath("/");

    return {
      status: "success",
      message: `Embedded ${result.embeddedCount} conversations.`,
      embeddedCount: result.embeddedCount,
      skippedCount: result.skippedCount,
    };
  } catch {
    return {
      status: "error",
      message: "Conversation embedding failed. Check configuration and try again.",
      embeddedCount: null,
      skippedCount: null,
    };
  }
}
