import { redirect } from "next/navigation";
import { LifelogDashboard } from "@/components/lifelog-dashboard";
import {
  getDisplayTimeZone,
  getOpenAiEmbeddingEnv,
  getOwnerUserId,
} from "@/lib/env";
import { getDashboardData } from "@/lib/lifelog/dashboard-data";
import { normalizeDashboardQuery } from "@/lib/lifelog/dashboard-query";
import { createOpenAiEmbeddingClient } from "@/lib/lifelog/openai-embeddings";
import {
  normalizeRecallQuery,
  searchSemanticRecall,
  type SemanticRecallSearchResult,
} from "@/lib/lifelog/semantic-recall";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function readFirstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (user.id !== getOwnerUserId()) {
    redirect("/login?error=invalid_credentials");
  }

  const resolvedSearchParams = await searchParams;
  const displayTimeZone = getDisplayTimeZone();
  const renderedAt = new Date();
  const dashboardQuery = normalizeDashboardQuery(resolvedSearchParams);
  const dashboardData = await getDashboardData(supabase, {
    userId: user.id,
    query: dashboardQuery,
    displayTimeZone,
    now: renderedAt,
  });
  const recallQuery = normalizeRecallQuery(readFirstParam(resolvedSearchParams.recall));
  let semanticRecall: SemanticRecallSearchResult = { query: "", results: [] };

  if (recallQuery) {
    const { openAiApiKey, embeddingModel } = getOpenAiEmbeddingEnv();
    semanticRecall = await searchSemanticRecall({
      supabase,
      query: recallQuery,
      embedText: createOpenAiEmbeddingClient({
        apiKey: openAiApiKey,
        embeddingModel,
      }).embedText,
    });
  }

  return (
    <LifelogDashboard
      data={dashboardData}
      displayTimeZone={displayTimeZone}
      renderedAt={renderedAt.toISOString()}
      semanticRecall={semanticRecall}
    />
  );
}
