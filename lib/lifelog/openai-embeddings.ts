import "server-only";

type FetchLike = typeof fetch;

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

export const OPENAI_EMBEDDING_DIMENSIONS = 1536;
export const OPENAI_EMBEDDING_TIMEOUT_MS = 30_000;

class OpenAiEmbeddingStatusError extends Error {}

export function createOpenAiEmbeddingClient({
  apiKey,
  embeddingModel,
  fetch: fetchImpl = fetch,
  timeoutMs = OPENAI_EMBEDDING_TIMEOUT_MS,
}: {
  apiKey: string;
  embeddingModel: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}) {
  async function embedText(input: string) {
    const normalizedInput = input.replace(/\s+/g, " ").trim();
    if (!normalizedInput) {
      throw new Error("Embedding input must not be empty");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let payload: EmbeddingResponse;

    try {
      const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          input: normalizedInput,
          model: embeddingModel,
        }),
      });

      if (!response.ok) {
        throw new OpenAiEmbeddingStatusError(
          `OpenAI embedding request failed with ${response.status}`,
        );
      }

      payload = (await response.json()) as EmbeddingResponse;
    } catch (error) {
      if (error instanceof OpenAiEmbeddingStatusError) {
        throw error;
      }

      if (controller.signal.aborted || isAbortError(error)) {
        throw new Error("OpenAI embedding request timed out");
      }

      throw new Error("OpenAI embedding request failed");
    } finally {
      clearTimeout(timeout);
    }

    const embedding = payload.data?.[0]?.embedding;

    if (
      !Array.isArray(embedding) ||
      embedding.length !== OPENAI_EMBEDDING_DIMENSIONS ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("OpenAI embedding response did not include an embedding");
    }

    return embedding;
  }

  return { embedText };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}
