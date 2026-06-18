"use client";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { ArrowLeft, Bot, Loader2, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export function RecallChat() {
  const [input, setInput] = useState("");
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/recall-chat" }),
    [],
  );
  const { error, messages, sendMessage, status } = useChat({ transport });
  const isWorking = status === "streaming" || status === "submitted";

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
