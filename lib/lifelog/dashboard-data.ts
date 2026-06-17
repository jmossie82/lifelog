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
  lastSync: DashboardSyncRunRow | null;
  query: DashboardQuery;
  totalConversationCount: number;
  shownConversationCount: number;
  hasMoreConversations: boolean;
};

export function mapDashboardData({
  conversations,
  tasks,
  syncRuns,
  openTaskCount,
  query = { q: "", type: "all", range: "all", page: 1 },
  totalConversationCount,
}: {
  conversations: DashboardConversationRow[];
  tasks: DashboardTaskRow[];
  syncRuns: DashboardSyncRunRow[];
  openTaskCount?: number;
  query?: DashboardQuery;
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
    lastSync: syncRuns[0] ?? null,
    query,
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
  } = { userId: "" },
): Promise<DashboardData> {
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

  conversationsQuery = conversationsQuery
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(0, query.page * DASHBOARD_PAGE_SIZE - 1);

  const [conversationsResult, tasksResult, openTaskCountResult, syncRunsResult] =
    await Promise.all([
      conversationsQuery,
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
    totalConversationCount: conversationsResult.count ?? 0,
  });
}
