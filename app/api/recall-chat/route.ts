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

    let body: {
      chatId?: unknown;
      id?: unknown;
      messages?: unknown;
    };

    try {
      const parsedBody: unknown = await request.json();

      if (
        typeof parsedBody !== "object" ||
        parsedBody === null ||
        Array.isArray(parsedBody)
      ) {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }

      body = parsedBody as typeof body;
    } catch {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

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
    const latestClientUserMessageId =
      extractLatestClientUserMessageId(clientMessages);

    if (!latestClientUserMessageId) {
      return Response.json({ error: "Message id is required" }, { status: 400 });
    }

    const turnId = deriveRecallChatTurnId(chatId, latestClientUserMessageId);

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

        await ensureRecallChatSession(supabase, {
          latestUserText,
          sessionId: chatId,
          userId: user.id,
        });

        await saveRecallChatTurn(supabase, {
          latestUserText,
          responseMessage,
          sessionId: chatId,
          sources: sources.map((source) => ({
            citationId: source.citationId,
            conversationId: source.conversationId,
            title: source.title,
          })),
          turnId,
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

function extractLatestClientUserMessageId(
  messages: Array<{ id?: unknown; role?: unknown; parts?: unknown }>,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      message?.role !== "user" ||
      typeof message.id !== "string" ||
      !hasTextPart(message.parts)
    ) {
      continue;
    }

    const id = message.id.trim();

    if (
      id.length > 0 &&
      id.length <= 128 &&
      RECALL_CHAT_AI_SDK_ID_PATTERN.test(id)
    ) {
      return id;
    }
  }

  return null;
}

function deriveRecallChatTurnId(sessionId: string, clientMessageId: string) {
  const hash = createHash("sha256")
    .update(`recall-chat-turn:${sessionId}:${clientMessageId}`)
    .digest();

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

function hasTextPart(parts: unknown) {
  return (
    Array.isArray(parts) &&
    parts.some((part) => {
      if (typeof part !== "object" || part === null) return false;

      const candidate = part as { type?: unknown; text?: unknown };

      return (
        candidate.type === "text" &&
        typeof candidate.text === "string" &&
        candidate.text.trim().length > 0
      );
    })
  );
}
