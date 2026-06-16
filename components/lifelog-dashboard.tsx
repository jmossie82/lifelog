"use client";

import {
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
import {
  filterConversationsByTab,
  type ConversationFilterTab,
  type ConversationFilterType,
} from "@/lib/fieldy/conversation-filters";

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

const conversations: Conversation[] = [
  {
    id: "product-standup",
    time: "10:42 AM",
    title: "Product Standup",
    people: "You, Sarah Chen, Mike Lee, Priya Patel",
    summary: "Discussed onboarding flow updates, user feedback, and launch timing.",
    duration: "42:18",
    tasks: 3,
    type: "conversation",
    day: "today",
  },
  {
    id: "budget-call",
    time: "9:15 AM",
    title: "Call with John Anderson",
    people: "You, John Anderson",
    summary: "Reviewed Q2 goals, budget, hiring plan, and follow-up owners.",
    duration: "28:47",
    tasks: 2,
    type: "conversation",
    day: "today",
  },
  {
    id: "customer-interview",
    time: "8:02 AM",
    title: "Customer Interview - Acme Corp",
    people: "You, Lisa Gomez",
    summary: "Captured pain points with reporting, integration needs, and rollout risk.",
    duration: "31:05",
    tasks: 1,
    type: "mention",
    day: "today",
  },
  {
    id: "design-sync",
    time: "4:30 PM",
    title: "Design Sync",
    people: "You, Tom Liu, Emily Park",
    summary: "Reviewed dashboard navigation, component library updates, and search states.",
    duration: "36:12",
    tasks: 2,
    type: "note",
    day: "yesterday",
  },
  {
    id: "marketing-call",
    time: "2:00 PM",
    title: "Call with Priya Patel",
    people: "You, Priya",
    summary: "Aligned on campaign messaging, audience segments, and launch handoff.",
    duration: "22:33",
    tasks: 1,
    type: "conversation",
    day: "yesterday",
  },
  {
    id: "investor-prep",
    time: "11:20 AM",
    title: "Investor Update Prep",
    people: "You",
    summary: "Drafted notes and talking points for the upcoming investor update.",
    duration: "19:44",
    tasks: 0,
    type: "task",
    day: "yesterday",
  },
];

const initialTasks: Task[] = [
  {
    id: "onboarding",
    title: "Share onboarding flow prototype",
    source: "Sarah Chen - Product Standup",
    due: "Today",
    done: false,
  },
  {
    id: "budget",
    title: "Review Q2 budget draft",
    source: "John Anderson - Call",
    due: "Tomorrow",
    done: false,
  },
  {
    id: "integration",
    title: "Send integration docs",
    source: "Lisa Gomez - Acme Corp Interview",
    due: "Tomorrow",
    done: false,
  },
  {
    id: "design",
    title: "Schedule design review",
    source: "Tom Liu - Design Sync",
    due: "Jun 18",
    done: false,
  },
  {
    id: "campaign",
    title: "Confirm campaign messaging",
    source: "Priya Patel - Call",
    due: "Jun 19",
    done: true,
  },
];

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

function getConversationIcon(type: ConversationType) {
  if (type === "note") return Tags;
  if (type === "task") return Mic2;
  if (type === "mention") return BarChart3;
  return UsersRound;
}

export function LifelogDashboard() {
  const [activeTab, setActiveTab] = useState<ConversationFilterTab>("All");
  const [tasks, setTasks] = useState(initialTasks);
  const [chatInput, setChatInput] = useState("");
  const [recallAnswer, setRecallAnswer] = useState(
    "You promised to send the integration docs to Lisa Gomez and review the Q2 budget draft with John Anderson.",
  );

  const visibleConversations = useMemo(() => {
    return filterConversationsByTab(conversations, activeTab);
  }, [activeTab]);

  const openTaskCount = tasks.filter((task) => !task.done).length;

  function toggleTask(taskId: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, done: !task.done } : task,
      ),
    );
  }

  function handleRecallSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    setRecallAnswer(
      `I found ${openTaskCount} open action items connected to "${trimmed}". Product Standup and the Acme interview are the strongest matches.`,
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

        <button className="sync-button" type="button">
          <RefreshCcw aria-hidden="true" size={18} />
          Sync Fieldy
        </button>

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
            Jun 16, 2026
            <ChevronDown aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="content-grid">
          <section className="main-panel">
            <div className="metrics-grid" aria-label="Lifelog summary metrics">
              {[
                ["Conversations today", "12", "20% vs yesterday"],
                ["Week", "4h 38m", "15% vs yesterday"],
                ["People", "18", "12 unique"],
                ["Action items", "9", "29% vs yesterday"],
              ].map(([label, value, delta]) => (
                <article className="metric" key={label}>
                  <p>{label}</p>
                  <strong>{value}</strong>
                  <span>{delta}</span>
                </article>
              ))}
              <article className="metric sync-metric">
                <p>Sync status</p>
                <strong>
                  <Check aria-hidden="true" size={19} />
                  All synced
                </strong>
                <span>Last sync 2m ago</span>
              </article>
            </div>

            <div className="timeline-card">
              <div className="timeline-toolbar">
                <div className="tab-list" role="tablist" aria-label="Timeline filters">
                  {tabs.map((tab) => (
                    <button
                      aria-selected={activeTab === tab}
                      className={activeTab === tab ? "tab is-active" : "tab"}
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      role="tab"
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

              <TimelineGroup
                conversations={visibleConversations.filter(
                  (conversation) => conversation.day === "today",
                )}
                title="Today - Jun 16, 2026"
              />
              <TimelineGroup
                conversations={visibleConversations.filter(
                  (conversation) => conversation.day === "yesterday",
                )}
                title="Yesterday - Jun 15, 2026"
              />

              <footer className="timeline-footer">
                <span>Showing {visibleConversations.length} of 247 conversations</span>
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
                      onChange={() => toggleTask(task.id)}
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
                {[
                  ["onboarding", 18],
                  ["launch", 14],
                  ["integration", 12],
                  ["dashboard", 11],
                  ["budget", 10],
                ].map(([keyword, count]) => (
                  <div className="keyword-row" key={keyword}>
                    <span>{keyword}</span>
                    <meter max="20" min="0" value={count as number} />
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
