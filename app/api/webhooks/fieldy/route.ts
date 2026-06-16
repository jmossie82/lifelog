import { type NextRequest, NextResponse } from "next/server";

import { getFieldyEnv, getFieldyWebhookSecret, getOwnerUserId } from "@/lib/env";
import { createFieldyClient, FieldyApiError } from "@/lib/fieldy/client";
import {
  assessMatchedConversationSafety,
  buildWindow,
  getBoundedConversationRange,
  selectMatchingConversationSets,
  type FieldyConversationSetCandidate,
} from "@/lib/fieldy/webhook-reconciliation";
import { validateFieldyWebhookPayload } from "@/lib/fieldy/webhook-validation";
import { createIngestionService } from "@/lib/lifelog/ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

const FIELDY_REQUEST_SPACING_MS = 2100;

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type SyncRunRow = Database["public"]["Tables"]["sync_runs"]["Row"];
type SyncRunInsert = Database["public"]["Tables"]["sync_runs"]["Insert"];
type SyncRunUpdate = Database["public"]["Tables"]["sync_runs"]["Update"];
type SyncRunStatus = Database["public"]["Tables"]["sync_runs"]["Row"]["status"];
type SyncRunsTable = {
  insert(values: SyncRunInsert): {
    select(): {
      single(): Promise<{ data: SyncRunRow | null; error: unknown }>;
    };
  };
  update(values: SyncRunUpdate): {
    eq(column: "id", value: string): Promise<{ error: unknown }>;
  };
};

function toSafeErrorMessage(error: unknown) {
  if (error instanceof FieldyApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message === "Invalid Fieldy webhook date") {
    return error.message;
  }

  return "Fieldy webhook reconciliation failed";
}

async function createSyncRun(
  supabase: SupabaseAdminClient,
  ownerUserId: string,
) {
  const syncRuns = supabase.from("sync_runs") as unknown as SyncRunsTable;
  const { data, error } = await syncRuns
    .insert({
      user_id: ownerUserId,
      source: "webhook",
      status: "running",
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("Sync run insert returned no row");
  }

  return data;
}

async function finishSyncRun({
  supabase,
  syncRunId,
  status,
  importedCount,
  errorMessage,
}: {
  supabase: SupabaseAdminClient;
  syncRunId: string;
  status: SyncRunStatus;
  importedCount: number;
  errorMessage?: string | null;
}) {
  const syncRuns = supabase.from("sync_runs") as unknown as SyncRunsTable;
  const { error } = await syncRuns
    .update({
      status,
      imported_count: importedCount,
      error_message: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", syncRunId);

  if (error) {
    throw error;
  }
}

export async function POST(request: NextRequest) {
  let supabase: SupabaseAdminClient | null = null;
  let syncRunId: string | null = null;
  let importedCount = 0;

  try {
    const fieldyWebhookSecret = getFieldyWebhookSecret();
    const secret = request.nextUrl.searchParams.get("secret");

    if (secret !== fieldyWebhookSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fieldyApiKey } = getFieldyEnv();
    const ownerUserId = getOwnerUserId();

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const validation = validateFieldyWebhookPayload(body);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status },
      );
    }

    supabase = createSupabaseAdminClient();
    const syncRun = await createSyncRun(supabase, ownerUserId);
    syncRunId = syncRun.id;

    const window = buildWindow(validation.payload.date);
    const fieldyClient = createFieldyClient({
      apiKey: fieldyApiKey,
      minRequestSpacingMs: FIELDY_REQUEST_SPACING_MS,
    });
    const ingestion = createIngestionService({ supabase, ownerUserId });
    const conversations = await fieldyClient.fetchConversations({
      ...window,
      mode: "intersects-range",
    });

    if (conversations.length === 0) {
      const errorMessage = "No canonical Fieldy conversation matched webhook date";
      await finishSyncRun({
        supabase,
        syncRunId,
        status: "failed",
        importedCount: 0,
        errorMessage,
      });

      return NextResponse.json({
        accepted: true,
        importedCount: 0,
        status: "failed",
      });
    }

    const candidateSets: FieldyConversationSetCandidate[] = [];

    for (const conversation of conversations) {
      const transcriptionRange = getBoundedConversationRange(conversation);
      const transcriptions = transcriptionRange
        ? await fieldyClient.fetchTranscriptions(transcriptionRange)
        : [];

      candidateSets.push({
        transcriptions,
        conversation,
      });
    }

    const matchingSets = selectMatchingConversationSets(
      validation.payload,
      candidateSets,
    );

    if (matchingSets.length === 0) {
      const errorMessage = "No canonical Fieldy transcription matched webhook text";
      await finishSyncRun({
        supabase,
        syncRunId,
        status: "failed",
        importedCount: 0,
        errorMessage,
      });

      return NextResponse.json({
        accepted: true,
        importedCount: 0,
        status: "failed",
      });
    }

    if (matchingSets.length > 1) {
      const errorMessage = "Multiple canonical Fieldy conversations matched webhook text";
      await finishSyncRun({
        supabase,
        syncRunId,
        status: "failed",
        importedCount: 0,
        errorMessage,
      });

      return NextResponse.json({
        accepted: true,
        importedCount: 0,
        status: "failed",
      });
    }

    const matchedSet = matchingSets[0];
    const safety = assessMatchedConversationSafety(matchedSet, candidateSets);

    if (!safety.ok) {
      await finishSyncRun({
        supabase,
        syncRunId,
        status: "failed",
        importedCount: 0,
        errorMessage: safety.errorMessage,
      });

      return NextResponse.json({
        accepted: true,
        importedCount: 0,
        status: "failed",
      });
    }

    const matchedTranscriptions = await fieldyClient.fetchTranscriptions(
      safety.transcriptionRange,
    );
    const result = await ingestion.ingestConversationSet({
      conversation: matchedSet.conversation,
      transcriptions: matchedTranscriptions,
      tasks: [],
    });
    importedCount =
      result.conversationCount + result.transcriptionCount + result.taskCount;

    await finishSyncRun({
      supabase,
      syncRunId,
      status: "succeeded",
      importedCount,
    });

    return NextResponse.json({
      accepted: true,
      importedCount,
      status: "succeeded",
    });
  } catch (error) {
    if (supabase && syncRunId) {
      try {
        await finishSyncRun({
          supabase,
          syncRunId,
          status: "failed",
          importedCount,
          errorMessage: toSafeErrorMessage(error),
        });
      } catch {
        // Preserve the webhook response contract even if failure recording fails.
      }
    }

    return NextResponse.json(
      { accepted: false, error: "Fieldy webhook reconciliation failed" },
      { status: 500 },
    );
  }
}
