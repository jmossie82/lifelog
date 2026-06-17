import type {
  FieldyConversation,
  FieldyTask,
  FieldyTranscription,
} from "../../lib/fieldy/types.ts";

export const FIELDY_REQUEST_SPACING_MS = 2100;

type CurrentUser = {
  id: string;
} | null;

type FieldyBackfillEnv = {
  fieldyApiKey: string;
  fieldyBackfillDays: number;
};

type SyncRunRow = {
  id: string;
};
type SyncRunInsert = {
  user_id: string;
  source: "backfill";
  status: "running";
};
type SyncRunUpdate = {
  status: "running" | "succeeded" | "failed";
  imported_count: number;
  error_message: string | null;
  finished_at: string;
};
type SyncRunStatus = SyncRunUpdate["status"];
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
type SyncRunSupabase = {
  from(table: "sync_runs"): SyncRunsTable;
};

type FieldyClient = {
  fetchConversations(range: {
    startTime: string;
    endTime: string;
    mode: "intersects-range";
  }): Promise<FieldyConversation[]>;
  fetchTasks(): Promise<FieldyTask[]>;
  fetchTranscriptions(range: {
    startTime: string;
    endTime: string;
  }): Promise<FieldyTranscription[]>;
};

type IngestionService = {
  ingestConversationSet(input: {
    conversation: FieldyConversation;
    transcriptions: FieldyTranscription[];
    tasks: FieldyTask[];
  }): Promise<{
    conversationCount: number;
    transcriptionCount: number;
    taskCount: number;
  }>;
};

export type FieldyBackfillDependencies<TSupabase> = {
  getOwnerUserId(): string;
  getCurrentUser(): Promise<CurrentUser>;
  getFieldyEnv(): FieldyBackfillEnv;
  createSupabaseAdminClient(): TSupabase;
  createFieldyClient(options: {
    apiKey: string;
    minRequestSpacingMs: number;
  }): FieldyClient;
  createIngestionService(options: {
    supabase: TSupabase;
    ownerUserId: string;
  }): IngestionService;
  revalidatePath(path: string): void;
  now?: () => Date;
};

function buildBackfillRange(days: number, now: Date) {
  const end = new Date(now);
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

function getSyncRunsTable<TSupabase>(supabase: TSupabase) {
  return (supabase as SyncRunSupabase).from("sync_runs");
}

async function createSyncRun<TSupabase>(
  supabase: TSupabase,
  ownerUserId: string,
) {
  const { data, error } = await getSyncRunsTable(supabase)
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

async function finishSyncRun<TSupabase>({
  supabase,
  syncRunId,
  status,
  importedCount,
  errorMessage,
  now,
}: {
  supabase: TSupabase;
  syncRunId: string;
  status: SyncRunStatus;
  importedCount: number;
  errorMessage?: string | null;
  now: () => Date;
}) {
  const { error } = await getSyncRunsTable(supabase)
    .update({
      status,
      imported_count: importedCount,
      error_message: errorMessage ?? null,
      finished_at: now().toISOString(),
    })
    .eq("id", syncRunId);

  if (error) {
    throw error;
  }
}

function getConversationTranscriptionRange(conversation: FieldyConversation) {
  if (!conversation.startTime || !conversation.endTime) {
    return null;
  }

  return {
    startTime: conversation.startTime,
    endTime: conversation.endTime,
  };
}

function groupTasksByMemoryId(tasks: FieldyTask[]) {
  const grouped = new Map<string, FieldyTask[]>();

  for (const task of tasks) {
    if (!task.memoryId) continue;

    const taskGroup = grouped.get(task.memoryId) ?? [];
    taskGroup.push(task);
    grouped.set(task.memoryId, taskGroup);
  }

  return grouped;
}

export async function runFieldyBackfill<TSupabase>({
  getOwnerUserId,
  getCurrentUser,
  getFieldyEnv,
  createSupabaseAdminClient,
  createFieldyClient,
  createIngestionService,
  revalidatePath,
  now = () => new Date(),
}: FieldyBackfillDependencies<TSupabase>) {
  let supabase: TSupabase | null = null;
  let syncRunId: string | null = null;
  let importedCount = 0;

  try {
    const ownerUserId = getOwnerUserId();
    const user = await getCurrentUser();

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
    const range = buildBackfillRange(fieldyBackfillDays, now());
    const conversations = await fieldyClient.fetchConversations({
      ...range,
      mode: "intersects-range",
    });
    const tasks = await fieldyClient.fetchTasks();
    const tasksByMemoryId = groupTasksByMemoryId(tasks);
    const ingestion = createIngestionService({ supabase, ownerUserId });

    for (const conversation of conversations) {
      const transcriptionRange = getConversationTranscriptionRange(conversation);
      const transcriptions = transcriptionRange
        ? await fieldyClient.fetchTranscriptions(transcriptionRange)
        : [];
      const result = await ingestion.ingestConversationSet({
        conversation,
        transcriptions,
        tasks: tasksByMemoryId.get(conversation.id) ?? [],
      });
      importedCount +=
        result.conversationCount + result.transcriptionCount + result.taskCount;
    }

    await finishSyncRun({
      supabase,
      syncRunId,
      status: "succeeded",
      importedCount,
      now,
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
          now,
        });
      } catch {
        // Preserve the backfill response even if failure recording fails.
      }
    }

    revalidatePath("/");

    return { ok: false, error: "Fieldy backfill failed" };
  }
}
