"use server";

import { revalidatePath } from "next/cache";

import { getFieldyEnv, getOwnerUserId } from "@/lib/env";
import { createFieldyClient } from "@/lib/fieldy/client";
import type { FieldyTask } from "@/lib/fieldy/types";
import { createIngestionService } from "@/lib/lifelog/ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

function buildBackfillRange(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "Fieldy backfill encountered an unbounded conversation") {
      return error.message;
    }

    const match = error.message.match(/^Fieldy API request failed with \d+$/);
    if (match) {
      return match[0];
    }
  }

  return "Fieldy backfill failed";
}

async function createSyncRun(
  supabase: SupabaseAdminClient,
  ownerUserId: string,
) {
  const syncRuns = supabase.from("sync_runs") as unknown as SyncRunsTable;
  const { data, error } = await syncRuns
    .insert({
      user_id: ownerUserId,
      source: "backfill",
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

function getConversationTranscriptionRange(conversation: {
  startTime?: string | null;
  endTime?: string | null;
}) {
  if (!conversation.startTime || !conversation.endTime) {
    throw new Error("Fieldy backfill encountered an unbounded conversation");
  }

  return {
    startTime: conversation.startTime,
    endTime: conversation.endTime,
  };
}

function getConversationTasks(tasks: FieldyTask[], conversationId: string) {
  return tasks.filter((task) => task.memoryId === conversationId);
}

export async function backfillFieldy() {
  let supabase: SupabaseAdminClient | null = null;
  let syncRunId: string | null = null;
  let importedCount = 0;

  try {
    const ownerUserId = getOwnerUserId();
    const serverSupabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await serverSupabase.auth.getUser();

    if (!user || user.id !== ownerUserId) {
      return { ok: false, error: "Unauthorized" };
    }

    const { fieldyApiKey, fieldyBackfillDays } = getFieldyEnv();
    supabase = createSupabaseAdminClient();
    const syncRun = await createSyncRun(supabase, ownerUserId);
    syncRunId = syncRun.id;

    const fieldyClient = createFieldyClient({
      apiKey: fieldyApiKey,
      minRequestSpacingMs: FIELDY_REQUEST_SPACING_MS,
    });
    const range = buildBackfillRange(fieldyBackfillDays);
    const conversations = await fieldyClient.fetchConversations({
      ...range,
      mode: "intersects-range",
    });
    const tasks = await fieldyClient.fetchTasks();
    const ingestion = createIngestionService({ supabase, ownerUserId });

    for (const conversation of conversations) {
      const transcriptions = await fieldyClient.fetchTranscriptions(
        getConversationTranscriptionRange(conversation),
      );
      const result = await ingestion.ingestConversationSet({
        conversation,
        transcriptions,
        tasks: getConversationTasks(tasks, conversation.id),
      });
      importedCount +=
        result.conversationCount + result.transcriptionCount + result.taskCount;
    }

    await finishSyncRun({
      supabase,
      syncRunId,
      status: "succeeded",
      importedCount,
    });

    revalidatePath("/");

    return { ok: true, importedCount };
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
        // Preserve the backfill response even if failure recording fails.
      }
    }

    revalidatePath("/");

    return { ok: false, error: "Fieldy backfill failed" };
  }
}
