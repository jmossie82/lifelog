import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDisplayTimeZone, getOwnerUserId } from "@/lib/env";
import {
  getConversationDetail,
  isUuid,
  type ConversationDetail,
} from "@/lib/lifelog/conversation-detail";
import { buildConversationBackHref } from "@/lib/lifelog/conversation-detail-route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function formatDateTime(value: string | null, displayTimeZone: string) {
  if (!value) return "No time";

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Invalid time";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: displayTimeZone,
  }).format(parsed);
}

function formatDuration(detail: ConversationDetail) {
  if (!detail.startedAt || !detail.endedAt) return "Pending";

  const durationMs =
    new Date(detail.endedAt).getTime() - new Date(detail.startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "Pending";

  const minutes = Math.round(durationMs / 60_000);
  return `${minutes} min`;
}

export default async function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const detailSearchParams = await searchParams;

  if (!isUuid(id)) {
    notFound();
  }

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

  const detail = await getConversationDetail(supabase, id, user.id);
  if (!detail) {
    notFound();
  }

  const displayTimeZone = getDisplayTimeZone();

  return (
    <main className="detail-shell">
      <div className="detail-topbar">
        <Link
          className="detail-back-link"
          href={buildConversationBackHref(detailSearchParams)}
        >
          Back to timeline
        </Link>
      </div>

      <article className="detail-layout">
        <header className="detail-header">
          <p>{detail.type}</p>
          <h1>{detail.title}</h1>
          <div className="detail-meta">
            <span>{formatDateTime(detail.startedAt, displayTimeZone)}</span>
            <span>{formatDuration(detail)}</span>
          </div>
        </header>

        <section className="detail-section">
          <h2>Summary</h2>
          <p>{detail.summary}</p>
        </section>

        <section className="detail-section">
          <h2>Keywords</h2>
          {detail.keywords.length > 0 ? (
            <div className="detail-keywords">
              {detail.keywords.map((keyword) => (
                <span key={keyword}>{keyword}</span>
              ))}
            </div>
          ) : (
            <p>No keywords stored.</p>
          )}
        </section>

        <section className="detail-section">
          <h2>Transcript</h2>
          {detail.transcript.length > 0 ? (
            <div className="transcript-list">
              {detail.transcript.map((segment) => (
                <article className="transcript-row" key={segment.id}>
                  <time>{formatDateTime(segment.startedAt, displayTimeZone)}</time>
                  <div>
                    <strong>{segment.speakerLabel ?? "Speaker"}</strong>
                    <p>{segment.text}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p>No transcript segments are stored for this conversation yet.</p>
          )}
        </section>

        <section className="detail-section">
          <h2>Action items</h2>
          {detail.tasks.length > 0 ? (
            <div className="detail-task-list">
              {detail.tasks.map((task) => (
                <article key={task.id}>
                  <strong>{task.title}</strong>
                  <span>{task.status}</span>
                  <em>
                    {task.dueAt
                      ? formatDateTime(task.dueAt, displayTimeZone)
                      : "No due date"}
                  </em>
                </article>
              ))}
            </div>
          ) : (
            <p>No linked action items.</p>
          )}
        </section>
      </article>
    </main>
  );
}
