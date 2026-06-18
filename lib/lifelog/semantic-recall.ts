import type { SupabaseClient } from "@supabase/supabase-js";

import type { GroundedRecallAnswer } from "@/lib/lifelog/grounded-recall";
import type { Database } from "@/lib/supabase/types";

export const RECALL_MAX_QUERY_LENGTH = 300;
export const RECALL_MATCH_COUNT = 10;
export const RECALL_MATCH_THRESHOLD = 0.7;

export type SemanticRecallResult = {
  id: string;
  title: string;
  summary: string;
  startedAt: string | null;
  endedAt: string | null;
  keywords: string[];
  similarity: number;
};

export type SemanticRecallSearchResult = {
  query: string;
  results: SemanticRecallResult[];
  answer?: GroundedRecallAnswer | null;
};

export function normalizeRecallQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, RECALL_MAX_QUERY_LENGTH);
}

export async function searchSemanticRecall({
  supabase,
  query,
  embedText,
  matchCount = RECALL_MATCH_COUNT,
  matchThreshold = RECALL_MATCH_THRESHOLD,
}: {
  supabase: SupabaseClient<Database>;
  query: string;
  embedText: (input: string) => Promise<number[]>;
  matchCount?: number;
  matchThreshold?: number;
}): Promise<SemanticRecallSearchResult> {
  const normalizedQuery = normalizeRecallQuery(query);
  if (!normalizedQuery) {
    return { query: "", results: [] };
  }

  const embedding = await embedText(normalizedQuery);
  const { data, error } = await supabase.rpc("match_conversations", {
    query_embedding: embedding,
    match_count: matchCount,
    match_threshold: matchThreshold,
  });

  if (error) {
    throw error;
  }

  return {
    query: normalizedQuery,
    results: (Array.isArray(data) ? data : []).map((row) =>
      mapSemanticRecallRow(row),
    ),
  };
}

function mapSemanticRecallRow(row: unknown): SemanticRecallResult {
  const record = readRecord(row);

  return {
    id: readString(record.id, ""),
    title: readString(record.title, "Untitled conversation"),
    summary: readString(record.summary, "No summary available yet."),
    startedAt: readNullableString(record.started_at),
    endedAt: readNullableString(record.ended_at),
    keywords: readKeywords(record.keywords),
    similarity: readFiniteNumber(record.similarity, 0),
  };
}

function readRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function readKeywords(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((keyword): keyword is string => typeof keyword === "string");
}

function readFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
