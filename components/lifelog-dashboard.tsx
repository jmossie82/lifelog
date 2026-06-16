"use client";

import {
  AlertCircle,
  BarChart3,
  BatteryFull,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Command,
  ListChecks,
  MessageSquareText,
  Mic2,
  MoreVertical,
  RefreshCcw,
  Search,
  SendHorizontal,
  Settings,
  Sparkles,
  Tags,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { backfillFieldy } from "@/app/actions/backfill-fieldy";
import {
  filterConversationsByTab,
  type ConversationFilterTab,
  type ConversationFilterType,
} from "@/lib/fieldy/conversation-filters";
import type { DashboardData } from "@/lib/lifelog/dashboard-data";

type ConversationType = ConversationFilterType;

type Conversation = {
  id: string;
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

const tabs = ["All", "Conversations", "Notes", "Tasks", "Mentions"] as const;
const syncFieldy = backfillFieldy as unknown as (
  formData: FormData,
) => Promise<void>;

function getConversationIcon(type: ConversationType) {
  if (type === "note") return Tags;
  if (type === "task") return Mic2;
  if (type === "mention") return BarChart3;
  return UsersRound;
}

function formatTime(value: string | null) {
  if (!value) return "No time";

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function formatDueDate(value: string | null) {
  if (!value) return "No due date";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
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

function getConversationDay(startedAt: string | null): Conversation["day"] {
  if (!startedAt) return "yesterday";

  const today = new Date();
  const startedDate = new Date(startedAt);

  return today.toDateString() === startedDate.toDateString() ? "today" : "yesterday";
}

export function LifelogDashboard({ data }: { data: DashboardData }) {
  const [activeTab, setActiveTab] = useState<ConversationFilterTab>("All");
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

  const conversations = useMemo<Conversation[]>(() => {
    return data.conversations.map((conversation) => ({
      id: conversation.id,
      time: formatTime(conversation.startedAt),
      title: conversation.title,
      people:
        conversation.keywords.length > 0
          ? `Keywords: ${conversation.keywords.slice(0, 3).join(", ")}`
          : "Imported from Fieldy",
      summary: conversation.summary,
      duration: formatDuration(conversation.startedAt, conversation.endedAt),
      tasks: taskCountsByConversationId.get(conversation.id) ?? 0,
      type: conversation.type,
      day: getConversationDay(conversation.startedAt),
    }));
  }, [data.conversations, taskCountsByConversationId]);

  const tasks = useMemo<Task[]>(() => {
    return data.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      source: task.conversationId
        ? (conversationTitleById.get(task.conversationId) ?? "Imported Fieldy task")
        : "Imported Fieldy task",
      due: formatDueDate(task.dueAt),
      done: task.status === "completed",
    }));
  }, [conversationTitleById, data.tasks]);

  const visibleConversations = useMemo(() => {
    return filterConversationsByTab(conversations, activeTab);
  }, [activeTab, conversations]);

  const hasImportedConversations = data.conversations.length > 0;
  const hasFilteredConversations = visibleConversations.length > 0;
  const openTaskCount = data.openTaskCount;
  const todayConversationCount = conversations.filter(
    (conversation) => conversation.day === "today",
  ).length;
  const keywordCounts = data.conversations
    .flatMap((conversation) => conversation.keywords)
    .reduce((counts, keyword) => {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());
  const keywordRows = [...keywordCounts]
    .sort(([, firstCount], [, secondCount]) => secondCount - firstCount)
    .slice(0, 5);
  const keywordCount = keywordCounts.size;
  const keywordMax = Math.max(...keywordRows.map(([, count]) => count), 1);
  const currentDate = new Date();
  const yesterdayDate = new Date(currentDate);
  yesterdayDate.setDate(currentDate.getDate() - 1);
  const syncStatus = data.lastSync?.status ?? "Not synced";
  const SyncStatusIcon =
    data.lastSync?.status === "succeeded"
      ? Check
      : data.lastSync?.status === "failed"
        ? AlertCircle
        : RefreshCcw;
  const syncStatusClassName = `sync-status sync-status-${data.lastSync?.status ?? "idle"}`;

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

        <section className="device-card" aria-label="Fieldy device status">
          <span className="device-render" aria-hidden="true" />
          <div>
            <p>Fieldy Device</p>
            <strong>
              100% <BatteryFull aria-hidden="true" size={18} />
            </strong>
          </div>
        </section>

        <form action={syncFieldy}>
          <button className="sync-button" type="submit">
            <RefreshCcw aria-hidden="true" size={18} />
            Sync Fieldy
          </button>
        </form>

        <button className="profile-button" type="button">
          <span className="avatar">JS</span>
          <span>Jamie Smith</span>
          <ChevronDown aria-hidden="true" size={17} />
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search-command">
            <Search aria-hidden="true" size={20} />
            <input
              aria-label="Search conversations"
              placeholder="Search conversations, people, topics, tasks..."
              type="search"
            />
            <span>
              <Command aria-hidden="true" size={14} /> K
            </span>
          </label>
          <button className="date-button" type="button">
            <CalendarDays aria-hidden="true" size={19} />
            {formatDate(currentDate)}
            <ChevronDown aria-hidden="true" size={16} />
          </button>
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
                  {data.lastSync?.error_message ??
                    (data.lastSync?.finished_at
                      ? `Last sync ${new Intl.DateTimeFormat("en-US").format(
                          new Date(data.lastSync.finished_at),
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
                      aria-pressed={activeTab === tab}
                      className={activeTab === tab ? "tab is-active" : "tab"}
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      type="button"
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <button className="range-button" type="button">
                  All time
                  <ChevronDown aria-hidden="true" size={15} />
                </button>
              </div>

              {data.conversations.length === 0 ? (
                <section className="empty-state">
                  <h2>No Fieldy conversations imported yet</h2>
                  <p>Run a manual sync to backfill your recent Fieldy history.</p>
                </section>
              ) : null}

              {hasImportedConversations && !hasFilteredConversations ? (
                <section className="empty-state">
                  <h2>No items in this view yet</h2>
                  <p>Try another timeline filter to see imported Fieldy conversations.</p>
                </section>
              ) : null}

              <TimelineGroup
                conversations={visibleConversations.filter(
                  (conversation) => conversation.day === "today",
                )}
                title={`Today - ${formatDate(currentDate)}`}
              />
              <TimelineGroup
                conversations={visibleConversations.filter(
                  (conversation) => conversation.day === "yesterday",
                )}
                title={`Earlier - ${formatDate(yesterdayDate)} and before`}
              />

              <footer className="timeline-footer">
                <span>
                  Showing {visibleConversations.length} of {data.conversations.length} conversations
                </span>
                <button type="button">
                  Load more <ChevronDown aria-hidden="true" size={15} />
                </button>
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
            <button aria-label={`More actions for ${conversation.title}`} type="button">
              <MoreVertical aria-hidden="true" size={18} />
            </button>
          </article>
        );
      })}
    </section>
  );
}
