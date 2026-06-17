import "server-only";

type FetchLike = typeof fetch;

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

export const OPENAI_EMBEDDING_DIMENSIONS = 1536;

export function createOpenAiEmbeddingClient({
  apiKey,
  embeddingModel,
  fetch: fetchImpl = fetch,
}: {
  apiKey: string;
  embeddingModel: string;
  fetch?: FetchLike;
}) {
  async function embedText(input: string) {
    const normalizedInput = input.replace(/\s+/g, " ").trim();
    if (!normalizedInput) {
      throw new Error("Embedding input must not be empty");
    }

    const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: normalizedInput,
        model: embeddingModel,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding request failed with ${response.status}`);
    }

    const payload = (await response.json()) as EmbeddingResponse;
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
