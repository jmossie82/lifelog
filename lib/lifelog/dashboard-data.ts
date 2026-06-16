import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";

type ConversationTableRow = Database["public"]["Tables"]["conversations"]["Row"];
type TaskTableRow = Database["public"]["Tables"]["tasks"]["Row"];
type SyncRunTableRow = Database["public"]["Tables"]["sync_runs"]["Row"];

export type DashboardConversationRow = Pick<
  ConversationTableRow,
  "id" | "fieldy_id" | "title" | "summary" | "started_at" | "ended_at" | "keywords"
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
};

export function mapDashboardData({
  conversations,
  tasks,
  syncRuns,
}: {
  conversations: DashboardConversationRow[];
  tasks: DashboardTaskRow[];
  syncRuns: DashboardSyncRunRow[];
}): DashboardData {
  return {
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      fieldyId: conversation.fieldy_id,
      title: conversation.title ?? "Untitled conversation",
      summary: conversation.summary ?? "No summary available yet.",
      startedAt: conversation.started_at,
      endedAt: conversation.ended_at,
      keywords: conversation.keywords,
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.due_at,
      conversationId: task.conversation_id,
    })),
    openTaskCount: tasks.filter((task) => task.status !== "completed").length,
    lastSync: syncRuns[0] ?? null,
  };
}

export async function getDashboardData(
  supabase: SupabaseClient<Database>,
): Promise<DashboardData> {
  const [conversationsResult, tasksResult, syncRunsResult] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, fieldy_id, title, summary, started_at, ended_at, keywords")
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(50),
    supabase
      .from("tasks")
      .select("id, title, status, due_at, conversation_id")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("sync_runs")
      .select(
        "id, source, status, started_at, finished_at, imported_count, error_message",
      )
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  if (conversationsResult.error) {
    throw conversationsResult.error;
  }

  if (tasksResult.error) {
    throw tasksResult.error;
  }

  if (syncRunsResult.error) {
    throw syncRunsResult.error;
  }

  return mapDashboardData({
    conversations: conversationsResult.data ?? [],
    tasks: tasksResult.data ?? [],
    syncRuns: syncRunsResult.data ?? [],
  });
}
