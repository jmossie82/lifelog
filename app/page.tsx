import { redirect } from "next/navigation";
import { LifelogDashboard } from "@/components/lifelog-dashboard";
import {
  getDisplayTimeZone,
  getOpenAiEmbeddingEnv,
  getOpenAiRecallEnv,
  getOwnerUserId,
} from "@/lib/env";
import { getDashboardData } from "@/lib/lifelog/dashboard-data";
import { normalizeDashboardQuery } from "@/lib/lifelog/dashboard-query";
import { readFirstSearchParam } from "@/lib/lifelog/conversation-detail-route";
import {
  answerGroundedRecall,
  getGroundedRecallErrorAnswer,
} from "@/lib/lifelog/grounded-recall";
import { createOpenAiEmbeddingClient } from "@/lib/lifelog/openai-embeddings";
import { createOpenAiResponsesClient } from "@/lib/lifelog/openai-responses";
import {
  normalizeRecallQuery,
  searchSemanticRecall,
  type SemanticRecallSearchResult,
} from "@/lib/lifelog/semantic-recall";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const recallQuery = normalizeRecallQuery(
    readFirstSearchParam(resolvedSearchParams.recall),
  );
  let semanticRecall: SemanticRecallSearchResult = {
    query: "",
    results: [],
    answer: null,
  };

  if (recallQuery) {
    try {
      const { openAiApiKey, embeddingModel } = getOpenAiEmbeddingEnv();
      semanticRecall = await searchSemanticRecall({
        supabase,
        query: recallQuery,
        embedText: createOpenAiEmbeddingClient({
          apiKey: openAiApiKey,
          embeddingModel,
        }).embedText,
      });

      try {
        const { recallAnswerModel } = getOpenAiRecallEnv();
        semanticRecall.answer = await answerGroundedRecall({
          query: semanticRecall.query,
          results: semanticRecall.results,
          generateAnswer: createOpenAiResponsesClient({
            apiKey: openAiApiKey,
            model: recallAnswerModel,
          }).createGroundedRecallAnswer,
        });
      } catch {
        semanticRecall.answer = getGroundedRecallErrorAnswer(
          semanticRecall.results.length > 0,
        );
      }
    } catch {
      semanticRecall = {
        query: recallQuery,
        results: [],
        answer: getGroundedRecallErrorAnswer(),
      };
    }
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
