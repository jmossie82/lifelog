"use client";

import type { UIMessage } from "ai";
import type { RecallChatSessionSummary } from "@/lib/lifelog/recall-chat-persistence";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { ArrowLeft, Bot, Loader2, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export function RecallChat({
  initialMessages,
  initialSessions,
  selectedChatId: initialSelectedChatId,
}: {
  initialMessages: UIMessage[];
  initialSessions: RecallChatSessionSummary[];
  selectedChatId: string | null;
}) {
  const [input, setInput] = useState("");
  const [initialChatMessages, setInitialChatMessages] = useState(initialMessages);
  const [activeChatId, setActiveChatId] = useState(
    initialSelectedChatId ?? crypto.randomUUID(),
  );
  const selectedChatId = activeChatId;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/recall-chat",
        prepareSendMessagesRequest({ messages }) {
          return {
            body: {
              chatId: selectedChatId,
              messages,
            },
          };
        },
      }),
    [selectedChatId],
  );
  const { error, messages, sendMessage, setMessages, status } = useChat({
    id: selectedChatId,
    messages: initialChatMessages,
    transport,
  });
  const isWorking = status === "streaming" || status === "submitted";

  function handleNewChat() {
    const nextChatId = crypto.randomUUID();
    setInitialChatMessages([]);
    setActiveChatId(nextChatId);
    setMessages([]);
    window.history.replaceState(null, "", "/chat");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    sendMessage({ text: trimmedInput });
    setInput("");
  }

  return (
    <main className="chat-page">
      <section className="chat-shell" aria-label="Ask Recall">
        <header className="chat-header">
          <Link className="chat-back-link" href="/">
            <ArrowLeft aria-hidden="true" size={18} />
            <span>Dashboard</span>
          </Link>
          <div>
            <p>Recall chat</p>
            <h1>Ask Recall</h1>
          </div>
        </header>

        <aside className="chat-session-list" aria-label="Recall chat sessions">
          <button type="button" onClick={handleNewChat}>
            New chat
          </button>
          {initialSessions.map((session) => (
            <Link
              aria-current={session.id === selectedChatId ? "page" : undefined}
              className="chat-session-link"
              href={`/chat?chat=${session.id}`}
              key={session.id}
            >
              <strong>{session.title}</strong>
              <span>{session.messageCount} messages</span>
            </Link>
          ))}
        </aside>

        <div className="recall-thread" aria-live="polite">
          {messages.length === 0 ? (
            <section className="chat-empty">
              <Bot aria-hidden="true" size={28} />
              <h2>Ask about meetings, people, promises, or anything you remember vaguely.</h2>
              <p>Recall searches your imported Fieldy lifelog and answers from that private context.</p>
            </section>
          ) : null}

          {messages.map((message) => {
            const Icon = message.role === "user" ? UserRound : Bot;

            return (
              <article className={`chat-message chat-message-${message.role}`} key={message.id}>
                <div className="chat-message-icon">
                  <Icon aria-hidden="true" size={18} />
                </div>
                <div className="chat-message-body">
                  <strong>{message.role === "user" ? "You" : "Recall"}</strong>
                  {message.parts.map((part, index) =>
                    part.type === "text" ? (
                      <p key={`${message.id}-${index}`}>{part.text}</p>
                    ) : null,
                  )}
                </div>
              </article>
            );
          })}

          {isWorking ? (
            <p className="chat-status">
              <Loader2 aria-hidden="true" size={16} />
              Recall is thinking
            </p>
          ) : null}

          {error ? (
            <p className="chat-error" role="alert">
              Recall could not answer safely. Try again with a shorter question.
            </p>
          ) : null}
        </div>

        <form className="chat-form" onSubmit={handleSubmit}>
          <label className="chat-input-label" htmlFor="recall-chat-input">
            Ask Recall
          </label>
          <div className="chat-input-row">
            <input
              aria-label="Ask Recall"
              autoComplete="off"
              disabled={isWorking}
              id="recall-chat-input"
              onChange={(event) => setInput(event.currentTarget.value)}
              placeholder="What did I promise in the last sales call?"
              type="text"
              value={input}
            />
            <button disabled={isWorking || input.trim().length === 0} type="submit">
              <Send aria-hidden="true" size={18} />
              <span>Send</span>
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
