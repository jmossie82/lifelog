import { createHash } from "node:crypto";

import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText } from "ai";

import {
  getOpenAiEmbeddingEnv,
  getOpenAiRecallEnv,
  getOwnerUserId,
} from "@/lib/env";
import {
  buildRecallChatModelMessagesForTurn,
  buildRecallChatSystemPrompt,
  extractLatestUserText,
  getRecallChatSafeErrorMessage,
  parseRecallChatMessages,
  trimRecallChatHistory,
} from "@/lib/lifelog/recall-chat";
import {
  ensureRecallChatSession,
  getRecallChatMessages,
  normalizeRecallChatSessionId,
  saveRecallChatTurn,
} from "@/lib/lifelog/recall-chat-persistence";
import { buildGroundedRecallSources } from "@/lib/lifelog/grounded-recall";
import { createOpenAiEmbeddingClient } from "@/lib/lifelog/openai-embeddings";
import {
  normalizeRecallQuery,
  searchSemanticRecall,
} from "@/lib/lifelog/semantic-recall";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const RECALL_CHAT_AI_SDK_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== getOwnerUserId()) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      chatId?: unknown;
      id?: unknown;
      messages?: unknown;
    };
    const clientMessages = trimRecallChatHistory(
      parseRecallChatMessages(body.messages),
    );
    const latestUserText = normalizeRecallQuery(
      extractLatestUserText(clientMessages),
    );

    if (!latestUserText) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const chatId =
      normalizeRecallChatSessionId(body.chatId) ??
      deriveRecallChatSessionId(body.id) ??
      crypto.randomUUID();

    await ensureRecallChatSession(supabase, {
      latestUserText,
      sessionId: chatId,
      userId: user.id,
    });

    const storedMessages = await getRecallChatMessages(supabase, {
      sessionId: chatId,
      userId: user.id,
    });
    const modelMessages = buildRecallChatModelMessagesForTurn({
      storedMessages,
      latestUserText,
    });
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
      messages: await convertToModelMessages(modelMessages),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: [
        ...storedMessages,
        {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text", text: latestUserText }],
        },
      ],
      generateMessageId: () => crypto.randomUUID(),
      messageMetadata: ({ part }) => {
        if (part.type !== "start" && part.type !== "finish") return;

        return { chatId };
      },
      onFinish: async ({ responseMessage, isAborted }) => {
        if (isAborted) return;

        await saveRecallChatTurn(supabase, {
          latestUserText,
          responseMessage,
          sessionId: chatId,
          sources: sources.map((source) => ({
            citationId: source.citationId,
            conversationId: source.conversationId,
            title: source.title,
          })),
          userId: user.id,
        });
      },
    });
  } catch (error) {
    return Response.json(
      { error: getRecallChatSafeErrorMessage(error) },
      { status: 500 },
    );
  }
}

function deriveRecallChatSessionId(value: unknown) {
  if (typeof value !== "string") return null;

  const id = value.trim();

  if (
    id.length === 0 ||
    id.length > 128 ||
    !RECALL_CHAT_AI_SDK_ID_PATTERN.test(id)
  ) {
    return null;
  }

  const hash = createHash("sha256").update(`recall-chat:${id}`).digest();

  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  return [
    hash.subarray(0, 4).toString("hex"),
    hash.subarray(4, 6).toString("hex"),
    hash.subarray(6, 8).toString("hex"),
    hash.subarray(8, 10).toString("hex"),
    hash.subarray(10, 16).toString("hex"),
  ].join("-");
}
