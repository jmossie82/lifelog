import type { SemanticRecallResult } from "@/lib/lifelog/semantic-recall";

export const GROUNDED_RECALL_MAX_SOURCES = 5;
export const GROUNDED_RECALL_MAX_ANSWER_LENGTH = 1_600;

export type GroundedRecallSource = {
  citationId: string;
  conversationId: string;
  title: string;
  summary: string;
  startedAt: string | null;
  keywords: string[];
  similarity: number;
};

export type GroundedRecallCitation = GroundedRecallSource;

export type GroundedRecallAnswer = {
  status: "answered" | "insufficient_evidence" | "error";
  answer: string;
  citations: GroundedRecallCitation[];
};

export type GroundedRecallModelAnswer = {
  status: "answered" | "insufficient_evidence";
  answer: string;
  citationIds: string[];
};

export function buildGroundedRecallSources(
  results: SemanticRecallResult[],
): GroundedRecallSource[] {
  return results
    .slice(0, GROUNDED_RECALL_MAX_SOURCES)
    .map((result, index) => ({
      citationId: `S${index + 1}`,
      conversationId: result.id,
      title: result.title,
      summary: result.summary,
      startedAt: result.startedAt,
      keywords: result.keywords.slice(0, 8),
      similarity: result.similarity,
    }));
}

export async function answerGroundedRecall({
  query,
  results,
  generateAnswer,
}: {
  query: string;
  results: SemanticRecallResult[];
  generateAnswer: (input: {
    query: string;
    sources: GroundedRecallSource[];
  }) => Promise<GroundedRecallModelAnswer>;
}): Promise<GroundedRecallAnswer> {
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  const sources = buildGroundedRecallSources(results);

  if (!normalizedQuery || sources.length === 0) {
    return {
      status: "insufficient_evidence",
      answer: "I could not find enough matching lifelog entries to answer from your data.",
      citations: [],
    };
  }

  const modelAnswer = await generateAnswer({
    query: normalizedQuery,
    sources,
  });

  if (modelAnswer.status === "insufficient_evidence") {
    return {
      status: "insufficient_evidence",
      answer: sanitizeAnswer(
        modelAnswer.answer ||
          "I could not answer that confidently from the retrieved lifelog entries.",
      ),
      citations: [],
    };
  }

  const citations = mapCitations(modelAnswer.citationIds, sources);
  const answer = sanitizeAnswer(modelAnswer.answer);

  if (!answer || citations.length === 0) {
    return {
      status: "insufficient_evidence",
      answer: "I found related entries, but not enough cited evidence to answer confidently.",
      citations: [],
    };
  }

  return {
    status: "answered",
    answer,
    citations,
  };
}

export function getGroundedRecallErrorAnswer(
  hasSemanticMatches = false,
): GroundedRecallAnswer {
  return {
    status: "error",
    answer: hasSemanticMatches
      ? "Recall answer generation failed. The semantic matches are still available to inspect."
      : "Recall search failed. Try again or use regular dashboard search.",
    citations: [],
  };
}

function sanitizeAnswer(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, GROUNDED_RECALL_MAX_ANSWER_LENGTH);
}

function mapCitations(citationIds: string[], sources: GroundedRecallSource[]) {
  const sourceById = new Map(
    sources.map((source) => [source.citationId, source]),
  );
  const seen = new Set<string>();
  const citations: GroundedRecallCitation[] = [];

  for (const citationId of citationIds) {
    const source = sourceById.get(citationId);
    if (!source || seen.has(citationId)) {
      continue;
    }

    seen.add(citationId);
    citations.push(source);
  }

  return citations;
}
