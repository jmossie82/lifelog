import { type NextRequest, NextResponse } from "next/server";

import { getFieldyEnv, getOwnerUserId } from "@/lib/env";
import { createFieldyClient, FieldyApiError } from "@/lib/fieldy/client";
import type {
  FieldyTranscription,
  FieldyWebhookPayload,
} from "@/lib/fieldy/types";
import { validateFieldyWebhookPayload } from "@/lib/fieldy/webhook-validation";
import { createIngestionService } from "@/lib/lifelog/ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

const RECONCILIATION_WINDOW_MINUTES = 30;
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

function buildWindow(date: string) {
  const webhookDate = new Date(date);
  const webhookTime = webhookDate.getTime();

  if (Number.isNaN(webhookTime)) {
    throw new Error("Invalid Fieldy webhook date");
  }

  const windowMs = RECONCILIATION_WINDOW_MINUTES * 60 * 1000;

  return {
    startTime: new Date(webhookTime - windowMs).toISOString(),
    endTime: new Date(webhookTime + windowMs).toISOString(),
  };
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof FieldyApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message === "Invalid Fieldy webhook date") {
    return error.message;
  }

  return "Fieldy webhook reconciliation failed";
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesWebhookPayload(
  payload: FieldyWebhookPayload,
  transcriptions: FieldyTranscription[],
) {
  const webhookText = normalizeText(payload.transcription);
  if (!webhookText) {
    return false;
  }

  const canonicalText = normalizeText(
    transcriptions.map((transcription) => transcription.text).join(" "),
  );
  const webhookSegmentTexts = payload.transcriptions
    .map((segment) => normalizeText(segment.text))
    .filter(Boolean);

  return (
    canonicalText.includes(webhookText) ||
    webhookSegmentTexts.some((segment) => canonicalText.includes(segment))
  );
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
  const { fieldyApiKey, fieldyWebhookSecret } = getFieldyEnv();
  const ownerUserId = getOwnerUserId();
  const secret = request.nextUrl.searchParams.get("secret");

  if (secret !== fieldyWebhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const supabase = createSupabaseAdminClient();
  const syncRun = await createSyncRun(supabase, ownerUserId);

  try {
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
        syncRunId: syncRun.id,
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

    let importedCount = 0;
    let matchedCount = 0;

    for (const conversation of conversations) {
      const transcriptions = await fieldyClient.fetchTranscriptions({
        startTime: conversation.startTime ?? window.startTime,
        endTime: conversation.endTime ?? window.endTime,
      });

      if (!matchesWebhookPayload(validation.payload, transcriptions)) {
        continue;
      }

      const result = await ingestion.ingestConversationSet({
        conversation,
        transcriptions,
        tasks: [],
      });
      matchedCount += 1;
      importedCount +=
        result.conversationCount +
        result.transcriptionCount +
        result.taskCount;
    }

    if (matchedCount === 0) {
      const errorMessage = "No canonical Fieldy transcription matched webhook text";
      await finishSyncRun({
        supabase,
        syncRunId: syncRun.id,
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

    await finishSyncRun({
      supabase,
      syncRunId: syncRun.id,
      status: "succeeded",
      importedCount,
    });

    return NextResponse.json({
      accepted: true,
      importedCount,
      status: "succeeded",
    });
  } catch (error) {
    try {
      await finishSyncRun({
        supabase,
        syncRunId: syncRun.id,
        status: "failed",
        importedCount: 0,
        errorMessage: toSafeErrorMessage(error),
      });
    } catch {
      // Preserve the webhook response contract even if failure recording fails.
    }

    return NextResponse.json(
      { accepted: false, error: "Fieldy webhook reconciliation failed" },
      { status: 500 },
    );
  }
}
