import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DASHBOARD_PAGE_SIZE,
  buildConversationSearchFilter,
  getDashboardRangeBounds,
  type DashboardQuery,
} from "./dashboard-query.ts";
import type { Database, Json } from "@/lib/supabase/types";

type ConversationTableRow = Database["public"]["Tables"]["conversations"]["Row"];
type TaskTableRow = Database["public"]["Tables"]["tasks"]["Row"];
type SyncRunTableRow = Database["public"]["Tables"]["sync_runs"]["Row"];

export const OPEN_TASK_STATUSES = ["new", "approved"] as const;
const DASHBOARD_CONVERSATION_TYPES = [
  "conversation",
  "note",
  "task",
  "mention",
] as const;

export type DashboardConversationType =
  (typeof DASHBOARD_CONVERSATION_TYPES)[number];

export type DashboardConversationRow = Pick<
  ConversationTableRow,
  | "id"
  | "fieldy_id"
  | "title"
  | "summary"
  | "started_at"
  | "ended_at"
  | "keywords"
  | "fieldy_metadata"
>;

export type DashboardTaskRow = Pick<
  TaskTableRow,
  "id" | "title" | "status" | "due_at" | "conversation_id"
>;

export type DashboardSyncRunRow = Pick<
  SyncRunTableRow,
  | "id"
  | "source"
  | "status"
  | "started_at"
  | "finished_at"
  | "imported_count"
  | "error_message"
>;

export type DashboardSyncSummary = Omit<DashboardSyncRunRow, "error_message">;

export type DashboardSyncDisplay = {
  source: DashboardSyncRunRow["source"];
  status: DashboardSyncRunRow["status"];
  importedCount: number;
  finishedAt: string | null;
  displayError: string | null;
};

export type DashboardData = {
  conversations: Array<{
    id: string;
    fieldyId: string;
    title: string;
    summary: string;
    startedAt: string | null;
    endedAt: string | null;
    keywords: string[];
    type: DashboardConversationType;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    dueAt: string | null;
    conversationId: string | null;
  }>;
  openTaskCount: number;
  lastSync: DashboardSyncSummary | null;
  lastSyncDisplay: DashboardSyncDisplay | null;
  query: DashboardQuery;
  importedConversationCount: number;
  totalConversationCount: number;
  shownConversationCount: number;
  hasMoreConversations: boolean;
};

function toSafeSyncDisplayError(errorMessage: string | null) {
  if (!errorMessage) return null;

  const allowedMessages = new Set([
    "Fieldy backfill failed",
    "Fieldy webhook reconciliation failed",
    "No canonical Fieldy conversation matched webhook date",
    "No canonical Fieldy transcription matched webhook text",
    "Multiple canonical Fieldy conversations matched webhook text",
    "Invalid Fieldy webhook date",
  ]);

  if (
    allowedMessages.has(errorMessage) ||
    /^Fieldy API request failed with \d+$/.test(errorMessage)
  ) {
    return errorMessage;
  }

  return "Sync failed. Check Fieldy configuration and try again.";
}

function mapSyncRunSummary(
  syncRun: DashboardSyncRunRow | null,
): DashboardSyncSummary | null {
  if (!syncRun) return null;

  return {
    id: syncRun.id,
    source: syncRun.source,
    status: syncRun.status,
    started_at: syncRun.started_at,
    finished_at: syncRun.finished_at,
    imported_count: syncRun.imported_count,
  };
}

export function mapSyncRunDisplay(
  syncRun: DashboardSyncRunRow | null,
): DashboardSyncDisplay | null {
  if (!syncRun) return null;

  return {
    source: syncRun.source,
    status: syncRun.status,
    importedCount: syncRun.imported_count,
    finishedAt: syncRun.finished_at,
    displayError: toSafeSyncDisplayError(syncRun.error_message),
  };
}

export function mapDashboardData({
  conversations,
  tasks,
  syncRuns,
  openTaskCount,
  query = { q: "", type: "all", range: "all", page: 1 },
  importedConversationCount,
  totalConversationCount,
}: {
  conversations: DashboardConversationRow[];
  tasks: DashboardTaskRow[];
  syncRuns: DashboardSyncRunRow[];
  openTaskCount?: number;
  query?: DashboardQuery;
  importedConversationCount?: number | null;
  totalConversationCount?: number | null;
}): DashboardData {
  const openStatuses = new Set<string>(OPEN_TASK_STATUSES);
  const mappedConversations = conversations.map((conversation) => ({
    id: conversation.id,
    fieldyId: conversation.fieldy_id,
    title: conversation.title ?? "Untitled conversation",
    summary: conversation.summary ?? "No summary available yet.",
    startedAt: conversation.started_at,
    endedAt: conversation.ended_at,
    keywords: conversation.keywords,
    type: mapFieldyConversationType(conversation.fieldy_metadata),
  }));
  const conversationCount = totalConversationCount ?? mappedConversations.length;
  const importedCount = importedConversationCount ?? conversationCount;

  return {
    conversations: mappedConversations,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.due_at,
      conversationId: task.conversation_id,
    })),
    openTaskCount:
      openTaskCount ?? tasks.filter((task) => openStatuses.has(task.status)).length,
    lastSync: mapSyncRunSummary(syncRuns[0] ?? null),
    lastSyncDisplay: mapSyncRunDisplay(syncRuns[0] ?? null),
    query,
    importedConversationCount: importedCount,
    totalConversationCount: conversationCount,
    shownConversationCount: mappedConversations.length,
    hasMoreConversations: mappedConversations.length < conversationCount,
  };
}

function mapFieldyConversationType(
  fieldyMetadata: Json | undefined,
): DashboardConversationType {
  if (
    !fieldyMetadata ||
    Array.isArray(fieldyMetadata) ||
    typeof fieldyMetadata !== "object"
  ) {
    return "conversation";
  }

  const fieldyType = fieldyMetadata.type;
  if (typeof fieldyType !== "string") {
    return "conversation";
  }

  return DASHBOARD_CONVERSATION_TYPES.includes(
    fieldyType as DashboardConversationType,
  )
    ? (fieldyType as DashboardConversationType)
    : "conversation";
}

export async function getDashboardData(
  supabase: SupabaseClient<Database>,
  options: {
    userId: string;
    query?: DashboardQuery;
    displayTimeZone?: string;
    now?: Date;
  },
): Promise<DashboardData> {
  if (!options.userId.trim()) {
    throw new Error("getDashboardData requires an authenticated user id");
  }

  const query = options.query ?? { q: "", type: "all", range: "all", page: 1 };
  const now = options.now ?? new Date();
  const displayTimeZone = options.displayTimeZone ?? "America/Chicago";
  const rangeBounds = getDashboardRangeBounds({
    range: query.range,
    displayTimeZone,
    now,
  });

  let conversationsQuery = supabase
    .from("conversations")
    .select(
      "id, fieldy_id, title, summary, started_at, ended_at, keywords, fieldy_metadata",
      { count: "exact" },
    )
    .eq("user_id", options.userId);

  const searchFilter = buildConversationSearchFilter(query.q);
  if (searchFilter) {
    conversationsQuery = conversationsQuery.or(searchFilter);
  }

  if (query.type !== "all" && query.type !== "conversation") {
    conversationsQuery = conversationsQuery.filter("fieldy_metadata->>type", "eq", query.type);
  }

  if (query.type === "conversation") {
    conversationsQuery = conversationsQuery.or(
      "fieldy_metadata->>type.is.null,fieldy_metadata->>type.eq.conversation,fieldy_metadata->>type.not.in.(note,task,mention)",
    );
  }

  if (rangeBounds) {
    conversationsQuery = conversationsQuery
      .gte("started_at", rangeBounds.startedAtGte)
      .lt("started_at", rangeBounds.startedAtLt);
  }

  const importedConversationCountQuery = supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", options.userId);

  conversationsQuery = conversationsQuery
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(0, query.page * DASHBOARD_PAGE_SIZE - 1);

  const [
    conversationsResult,
    importedConversationCountResult,
    tasksResult,
    openTaskCountResult,
    syncRunsResult,
  ] =
    await Promise.all([
      conversationsQuery,
      importedConversationCountQuery,
      supabase
        .from("tasks")
        .select("id, title, status, due_at, conversation_id")
        .eq("user_id", options.userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", options.userId)
        .in("status", [...OPEN_TASK_STATUSES]),
      supabase
        .from("sync_runs")
        .select(
          "id, source, status, started_at, finished_at, imported_count, error_message",
        )
        .eq("user_id", options.userId)
        .order("started_at", { ascending: false })
        .limit(1),
    ]);

  if (conversationsResult.error) {
    throw conversationsResult.error;
  }

  if (importedConversationCountResult.error) {
    throw importedConversationCountResult.error;
  }

  if (tasksResult.error) {
    throw tasksResult.error;
  }

  if (openTaskCountResult.error) {
    throw openTaskCountResult.error;
  }

  if (syncRunsResult.error) {
    throw syncRunsResult.error;
  }

  return mapDashboardData({
    conversations: conversationsResult.data ?? [],
    tasks: tasksResult.data ?? [],
    syncRuns: syncRunsResult.data ?? [],
    openTaskCount: openTaskCountResult.count ?? 0,
    query,
    importedConversationCount: importedConversationCountResult.count ?? 0,
    totalConversationCount: conversationsResult.count ?? 0,
  });
}
