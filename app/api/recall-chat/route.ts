import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import {
  getOpenAiEmbeddingEnv,
  getOpenAiRecallEnv,
  getOwnerUserId,
} from "@/lib/env";
import {
  buildRecallChatSystemPrompt,
  extractLatestUserText,
  getRecallChatSafeErrorMessage,
  parseRecallChatMessages,
  trimRecallChatHistory,
} from "@/lib/lifelog/recall-chat";
import { buildGroundedRecallSources } from "@/lib/lifelog/grounded-recall";
import { createOpenAiEmbeddingClient } from "@/lib/lifelog/openai-embeddings";
import { searchSemanticRecall } from "@/lib/lifelog/semantic-recall";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== getOwnerUserId()) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { messages?: unknown };
    const messages = trimRecallChatHistory(
      parseRecallChatMessages(body.messages),
    );
    const latestUserText = extractLatestUserText(messages);

    if (!latestUserText) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const { openAiApiKey, embeddingModel } = getOpenAiEmbeddingEnv();
    const { recallAnswerModel } = getOpenAiRecallEnv();
    const { embedText } = createOpenAiEmbeddingClient({
      apiKey: openAiApiKey,
      embeddingModel,
    });
    const recall = await searchSemanticRecall({
      supabase,
      query: latestUserText,
      embedText,
    });
    const sources = buildGroundedRecallSources(recall.results);
    const result = streamText({
      model: openai(recallAnswerModel),
      system: buildRecallChatSystemPrompt(sources),
      messages: convertToModelMessages(messages as UIMessage[]),
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    return Response.json(
      { error: getRecallChatSafeErrorMessage(error) },
      { status: 500 },
    );
  }
}
