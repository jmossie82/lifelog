"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  ListChecks,
  MessageSquareText,
  Mic2,
  RefreshCcw,
  Search,
  SendHorizontal,
  Settings,
  Sparkles,
  Tags,
  UsersRound,
} from "lucide-react";
import { useActionState, useMemo, useState, useTransition } from "react";
import { backfillFieldy } from "@/app/actions/backfill-fieldy";
import {
  initialBackfillActionState,
  type BackfillActionState,
} from "@/lib/lifelog/backfill-action-state";
import type { DashboardData } from "@/lib/lifelog/dashboard-data";
import type { DashboardConversationFilterType } from "@/lib/lifelog/dashboard-query";

type ConversationType = DashboardData["conversations"][number]["type"];

type Conversation = {
  id: string;
  href: string;
  time: string;
  title: string;
  people: string;
  summary: string;
  duration: string;
  tasks: number;
  type: ConversationType;
  day: "today" | "yesterday";
};

type Task = {
  id: string;
  title: string;
  source: string;
  due: string;
  done: boolean;
};

const navItems = [
  { label: "Timeline", icon: BarChart3 },
  { label: "Search", icon: Search },
  { label: "Recall Chat", icon: MessageSquareText },
  { label: "Tasks", icon: ListChecks },
  { label: "Insights", icon: Tags },
  { label: "Calendar", icon: CalendarDays },
  { label: "Contacts", icon: UsersRound },
  { label: "Settings", icon: Settings },
];

const tabs: Array<{ label: string; value: DashboardConversationFilterType }> = [
  { label: "All", value: "all" },
  { label: "Conversations", value: "conversation" },
  { label: "Notes", value: "note" },
  { label: "Tasks", value: "task" },
  { label: "Mentions", value: "mention" },
];

const ranges = [
  { label: "All time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Week", value: "week" },
] as const;

function getConversationIcon(type: ConversationType) {
  if (type === "note") return Tags;
  if (type === "task") return Mic2;
  if (type === "mention") return BarChart3;
  return UsersRound;
}

function formatTime(value: string | null, displayTimeZone: string) {
  if (!value) return "No time";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: displayTimeZone,
  }).format(new Date(value));
}

function formatDate(value: Date, displayTimeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: displayTimeZone,
  }).format(value);
}

function formatDueDate(value: string | null, displayTimeZone: string) {
  if (!value) return "No due date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: displayTimeZone,
  }).format(new Date(value));
}

function formatDuration(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return "Pending";

  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "Pending";

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDateKey(value: Date, displayTimeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: displayTimeZone,
    year: "numeric",
  }).format(value);
}

function getDisplayDateParts(value: Date, displayTimeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: displayTimeZone,
    year: "numeric",
  }).formatToParts(value);

  return {
    day: Number(parts.find((part) => part.type === "day")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
}

function getPreviousDisplayDate(value: Date, displayTimeZone: string) {
  const { day, month, year } = getDisplayDateParts(value, displayTimeZone);
  return new Date(Date.UTC(year, month - 1, day - 1, 12));
}

function getConversationDay(
  startedAt: string | null,
  currentDate: Date,
  displayTimeZone: string,
): Conversation["day"] {
  if (!startedAt) return "yesterday";

  const startedDate = new Date(startedAt);

  return formatDateKey(currentDate, displayTimeZone) ===
    formatDateKey(startedDate, displayTimeZone)
    ? "today"
    : "yesterday";
}

export function LifelogDashboard({
  data,
  displayTimeZone,
  renderedAt,
}: {
  data: DashboardData;
  displayTimeZone: string;
  renderedAt: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, startTransition] = useTransition();
  const [backfillState, backfillAction, isSyncPending] = useActionState(
    backfillFieldy as (
      state: BackfillActionState,
      formData: FormData,
    ) => Promise<BackfillActionState>,
    initialBackfillActionState,
  );
  const [chatInput, setChatInput] = useState("");
  const [recallAnswer, setRecallAnswer] = useState(
    data.conversations.length > 0
      ? `Imported ${data.conversations.length} Fieldy conversations and ${data.openTaskCount} open action items.`
      : "Run a manual sync to import your recent Fieldy history.",
  );

  const conversationTitleById = useMemo(() => {
    return new Map(data.conversations.map((conversation) => [conversation.id, conversation.title]));
  }, [data.conversations]);

  const taskCountsByConversationId = useMemo(() => {
    return data.tasks.reduce((counts, task) => {
      if (!task.conversationId) return counts;

      counts.set(task.conversationId, (counts.get(task.conversationId) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());
  }, [data.tasks]);

  const currentDate = useMemo(() => new Date(renderedAt), [renderedAt]);
  const yesterdayDate = useMemo(
    () => getPreviousDisplayDate(currentDate, displayTimeZone),
    [currentDate, displayTimeZone],
  );

  function buildQueryString(updates: Record<string, string | null>) {
    const params = new URLSearchParams();
    if (data.query.q) params.set("q", data.query.q);
    if (data.query.type !== "all") params.set("type", data.query.type);
    if (data.query.range !== "all") params.set("range", data.query.range);
    if (data.query.page > 1) params.set("page", String(data.query.page));

    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "all" || (key === "page" && value === "1")) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
  }

  function navigateWith(updates: Record<string, string | null>) {
    startTransition(() => {
      router.push(`${pathname}${buildQueryString(updates)}`);
    });
  }

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const q = String(formData.get("q") ?? "").trim();
    navigateWith({ q: q || null, page: "1" });
  }

  const currentFromQuery = buildQueryString({});

  const conversations = useMemo<Conversation[]>(() => {
    return data.conversations.map((conversation) => ({
      id: conversation.id,
      href: `/conversations/${conversation.id}${
        currentFromQuery
          ? `?from=${encodeURIComponent(currentFromQuery)}`
          : ""
      }`,
      time: formatTime(conversation.startedAt, displayTimeZone),
      title: conversation.title,
      people:
        conversation.keywords.length > 0
          ? `Keywords: ${conversation.keywords.slice(0, 3).join(", ")}`
          : "Imported from Fieldy",
      summary: conversation.summary,
      duration: formatDuration(conversation.startedAt, conversation.endedAt),
      tasks: taskCountsByConversationId.get(conversation.id) ?? 0,
      type: conversation.type,
      day: getConversationDay(conversation.startedAt, currentDate, displayTimeZone),
    }));
  }, [
    currentFromQuery,
    currentDate,
    data.conversations,
    displayTimeZone,
    taskCountsByConversationId,
  ]);

  const tasks = useMemo<Task[]>(() => {
    return data.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      source: task.conversationId
        ? (conversationTitleById.get(task.conversationId) ?? "Imported Fieldy task")
        : "Imported Fieldy task",
      due: formatDueDate(task.dueAt, displayTimeZone),
      done: task.status === "completed",
    }));
  }, [conversationTitleById, data.tasks, displayTimeZone]);

  const visibleConversations = conversations;
  const hasImportedConversations = data.importedConversationCount > 0;
  const hasFilteredConversations = visibleConversations.length > 0;
  const hasActiveFilters =
    data.query.q.length > 0 ||
    data.query.type !== "all" ||
    data.query.range !== "all";
  const openTaskCount = data.openTaskCount;
  const { todayConversationCount, keywordRows, keywordCount, keywordMax } = useMemo(() => {
    const keywordCounts = data.conversations
      .flatMap((conversation) => conversation.keywords)
      .reduce((counts, keyword) => {
        counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
        return counts;
      }, new Map<string, number>());
    const keywordRowsValue = [...keywordCounts]
      .sort(([, firstCount], [, secondCount]) => secondCount - firstCount)
      .slice(0, 5);

    return {
      todayConversationCount: conversations.filter(
        (conversation) => conversation.day === "today",
      ).length,
      keywordRows: keywordRowsValue,
      keywordCount: keywordCounts.size,
      keywordMax: Math.max(...keywordRowsValue.map(([, count]) => count), 1),
    };
  }, [conversations, data.conversations]);
  const syncStatus = data.lastSyncDisplay?.status ?? "Not synced";
  const SyncStatusIcon =
    data.lastSyncDisplay?.status === "succeeded"
      ? Check
      : data.lastSyncDisplay?.status === "failed"
        ? AlertCircle
        : RefreshCcw;
  const syncStatusClassName = `sync-status sync-status-${data.lastSyncDisplay?.status ?? "idle"}`;

  function handleRecallSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    setRecallAnswer(
      data.conversations.length > 0
        ? `I found ${openTaskCount} open action items across ${data.conversations.length} imported conversations connected to "${trimmed}".`
        : `No imported conversations are available for "${trimmed}" yet. Run a manual sync to backfill Fieldy data.`,
    );
    setChatInput("");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <a className="brand" href="#">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>Fieldy Lifelog</span>
        </a>

        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.label === "Timeline";
            return (
              <a
                aria-current={isActive ? "page" : undefined}
                className={isActive ? "nav-item is-active" : "nav-item"}
                href="#"
                key={item.label}
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.9} />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <section className="sync-activity-panel" aria-label="Fieldy sync activity">
          <div>
            <p>Fieldy Sync</p>
            <strong className={syncStatusClassName}>
              <SyncStatusIcon aria-hidden="true" size={18} />
              <span>{data.lastSyncDisplay?.status ?? "Not synced"}</span>
            </strong>
          </div>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{data.lastSyncDisplay?.source ?? "None"}</dd>
            </div>
            <div>
              <dt>Imported</dt>
              <dd>{data.lastSyncDisplay?.importedCount ?? 0}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>
                {data.lastSyncDisplay?.finishedAt
                  ? formatDate(
                      new Date(data.lastSyncDisplay.finishedAt),
                      displayTimeZone,
                    )
                  : "Never"}
              </dd>
            </div>
          </dl>
          {data.lastSyncDisplay?.displayError ? (
            <p className="sync-error">{data.lastSyncDisplay.displayError}</p>
          ) : null}
          {backfillState.message ? (
            <p className={`sync-action-message sync-action-${backfillState.status}`}>
              {backfillState.message}
            </p>
          ) : null}
          <form action={backfillAction}>
            <button
              aria-label={isSyncPending ? "Syncing Fieldy" : "Sync Fieldy"}
              className="sync-button"
              disabled={isSyncPending}
              type="submit"
            >
              <RefreshCcw aria-hidden="true" size={18} />
              <span>{isSyncPending ? "Syncing..." : "Sync Fieldy"}</span>
            </button>
          </form>
        </section>

        <button className="profile-button" type="button">
          <span className="avatar">JS</span>
          <span>Jamie Smith</span>
          <ChevronDown aria-hidden="true" size={17} />
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <form className="search-command" onSubmit={handleSearchSubmit}>
            <Search aria-hidden="true" size={20} />
            <input
              aria-label="Search conversations"
              defaultValue={data.query.q}
              key={data.query.q}
              name="q"
              placeholder="Search conversations, topics, tasks..."
              type="search"
            />
            <button disabled={isNavigating} type="submit">Search</button>
          </form>
          <div className="range-control" aria-label="Date range">
            {ranges.map((range) => (
              <button
                aria-pressed={data.query.range === range.value}
                className={data.query.range === range.value ? "is-active" : ""}
                key={range.value}
                onClick={() => navigateWith({ range: range.value, page: "1" })}
                type="button"
              >
                {range.label}
              </button>
            ))}
          </div>
        </header>

        <div className="content-grid">
          <section className="main-panel">
            <div className="metrics-grid" aria-label="Lifelog summary metrics">
              {[
                [
                  "Conversations today",
                  String(todayConversationCount),
                  `${data.conversations.length} imported`,
                ],
                ["Recent", String(data.conversations.length), "Imported conversations"],
                ["Keywords", String(keywordCount), "Unique imported"],
                ["Action items", String(openTaskCount), `${data.tasks.length} recent shown`],
              ].map(([label, value, delta]) => (
                <article className="metric" key={label}>
                  <p>{label}</p>
                  <strong>{value}</strong>
                  <span>{delta}</span>
                </article>
              ))}
              <article className="metric sync-metric">
                <p>Sync status</p>
                <strong className={syncStatusClassName}>
                  <SyncStatusIcon aria-hidden="true" size={19} />
                  {syncStatus}
                </strong>
                <span>
                  {data.lastSyncDisplay?.displayError ??
                    (data.lastSyncDisplay?.finishedAt
                      ? `Last sync ${formatDate(
                          new Date(data.lastSyncDisplay.finishedAt),
                          displayTimeZone,
                        )}`
                      : "Run a sync to import Fieldy data")}
                </span>
              </article>
            </div>

            <div className="timeline-card">
              <div className="timeline-toolbar">
                <div className="tab-list" role="group" aria-label="Timeline filters">
                  {tabs.map((tab) => (
                    <button
                      aria-pressed={data.query.type === tab.value}
                      className={data.query.type === tab.value ? "tab is-active" : "tab"}
                      key={tab.value}
                      onClick={() => navigateWith({ type: tab.value, page: "1" })}
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {!hasImportedConversations ? (
                <section className="empty-state">
                  <h2>No Fieldy conversations imported yet</h2>
                  <p>Run a manual sync to backfill your recent Fieldy history.</p>
                </section>
              ) : null}

              {hasImportedConversations && hasActiveFilters && !hasFilteredConversations ? (
                <section className="empty-state">
                  <h2>No matching conversations</h2>
                  <p>Clear the search or choose another filter.</p>
                  <button
                    onClick={() =>
                      navigateWith({ q: null, type: "all", range: "all", page: "1" })
                    }
                    type="button"
                  >
                    Clear filters
                  </button>
                </section>
              ) : null}

              <TimelineGroup
                conversations={visibleConversations.filter(
                  (conversation) => conversation.day === "today",
                )}
                title={`Today - ${formatDate(currentDate, displayTimeZone)}`}
              />
              <TimelineGroup
                conversations={visibleConversations.filter(
                  (conversation) => conversation.day === "yesterday",
                )}
                title={`Earlier - ${formatDate(yesterdayDate, displayTimeZone)} and before`}
              />

              <footer className="timeline-footer">
                <span>
                  Showing {data.shownConversationCount} of {data.totalConversationCount} conversations
                </span>
                {data.hasMoreConversations ? (
                  <button
                    onClick={() => navigateWith({ page: String(data.query.page + 1) })}
                    type="button"
                  >
                    Load more <ChevronDown aria-hidden="true" size={15} />
                  </button>
                ) : null}
              </footer>
            </div>
          </section>

          <aside className="right-rail" aria-label="Tasks and recall">
            <section className="rail-panel">
              <div className="rail-header">
                <h2>Action items</h2>
                <span>{openTaskCount}</span>
                <button type="button">View all</button>
              </div>
              <div className="task-list">
                {tasks.map((task) => (
                  <label className={task.done ? "task-row is-done" : "task-row"} key={task.id}>
                    <input
                      checked={task.done}
                      disabled
                      readOnly
                      type="checkbox"
                    />
                    <span>
                      <strong>{task.title}</strong>
                      <small>{task.source}</small>
                    </span>
                    <em>{task.due}</em>
                  </label>
                ))}
              </div>
            </section>

            <section className="rail-panel">
              <div className="rail-header">
                <h2>Insights</h2>
              </div>
              <div className="insight-tabs" aria-label="Insight type">
                <button className="is-active" type="button">
                  Keywords
                </button>
                <button type="button">Speakers</button>
              </div>
              <div className="keyword-list">
                {keywordRows.map(([keyword, count]) => (
                  <div className="keyword-row" key={keyword}>
                    <span>{keyword}</span>
                    <meter
                      aria-label={`${keyword} keyword count`}
                      max={keywordMax}
                      min="0"
                      value={count}
                    />
                    <em>{count}</em>
                  </div>
                ))}
              </div>
            </section>

            <section className="rail-panel recall-panel">
              <div className="rail-header">
                <h2>
                  <Sparkles aria-hidden="true" size={18} />
                  Recall Chat
                </h2>
                <button aria-label="Refresh recall" type="button">
                  <RefreshCcw aria-hidden="true" size={16} />
                </button>
              </div>
              <div className="chat-thread">
                <p className="chat-bubble user">Ask what you promised last week</p>
                <p className="chat-bubble assistant">{recallAnswer}</p>
              </div>
              <form className="chat-form" onSubmit={handleRecallSubmit}>
                <input
                  aria-label="Ask anything about your conversations"
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Ask anything about your conversations..."
                  type="text"
                  value={chatInput}
                />
                <button aria-label="Send recall query" type="submit">
                  <SendHorizontal aria-hidden="true" size={19} />
                </button>
              </form>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function TimelineGroup({
  conversations: groupConversations,
  title,
}: {
  conversations: Conversation[];
  title: string;
}) {
  if (groupConversations.length === 0) return null;

  return (
    <section className="timeline-group" aria-label={title}>
      <h2>{title}</h2>
      {groupConversations.map((conversation) => {
        const Icon = getConversationIcon(conversation.type);
        return (
          <article className="conversation-row" key={conversation.id}>
            <Link className="conversation-link" href={conversation.href}>
              <div className="conversation-time">
                <span aria-hidden="true" />
                <time>{conversation.time}</time>
              </div>
              <div className={`conversation-icon type-${conversation.type}`}>
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
              </div>
              <div className="conversation-copy">
                <h3>{conversation.title}</h3>
                <p>{conversation.people}</p>
                <small>{conversation.summary}</small>
              </div>
              {conversation.tasks > 0 ? (
                <span className="task-count">{conversation.tasks} tasks</span>
              ) : (
                <span className="task-count is-empty">No tasks</span>
              )}
              <span className="duration">
                <Clock3 aria-hidden="true" size={15} />
                {conversation.duration}
              </span>
            </Link>
          </article>
        );
      })}
    </section>
  );
}
