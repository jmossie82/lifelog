import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("components/recall-chat.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

test("recall chat uses AI SDK 6 transport to the recall route", () => {
  assert.match(source, /"use client";/);
  assert.match(source, /import \{ DefaultChatTransport \} from "ai";/);
  assert.match(source, /import \{ useChat \} from "@ai-sdk\/react";/);
  assert.match(source, /import \{ useRouter \} from "next\/navigation";/);
  assert.match(source, /const router = useRouter\(\)/);
  assert.match(source, /useChat\(\{\s*id: selectedChatId,\s*messages: initialChatMessages,/);
  assert.match(source, /new DefaultChatTransport\(\{\s*api: "\/api\/recall-chat"/);
  assert.doesNotMatch(source, /useChat\(\{\s*api:/);
});

test("recall chat sends trimmed user text and clears local input", () => {
  assert.match(source, /useState\(""\)/);
  assert.match(source, /const trimmedInput = input\.trim\(\)/);
  assert.match(source, /if \(!trimmedInput\) return/);
  assert.match(source, /sendMessage\(\{ text: trimmedInput \}\)/);
  assert.match(source, /setInput\(""\)/);
});

test("recall chat UI sends chat id through DefaultChatTransport", () => {
  assert.match(source, /selectedChatId/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /prepareSendMessagesRequest/);
  assert.match(source, /body:\s*\{\s*chatId: selectedChatId/);
  assert.match(source, /messages,/);
});

test("recall chat UI renders session history and new chat control", () => {
  assert.match(source, /initialSessions/);
  assert.match(source, /initialMessages/);
  assert.match(source, /New chat/);
  assert.match(source, /chat-session-list/);
  assert.match(source, /chat-session-link/);
  assert.match(styles, /\.chat-session-list/);
  assert.match(styles, /\.chat-session-link/);
});

test("recall chat UI clears selected-session messages before starting a new chat", () => {
  assert.match(
    source,
    /const \[initialChatMessages, setInitialChatMessages\] = useState\(initialMessages\)/,
  );
  assert.match(
    source,
    /function handleNewChat\(\) \{[\s\S]*setInitialChatMessages\(\[\]\)[\s\S]*setActiveChatId\(nextChatId\)[\s\S]*setMessages\(\[\]\)/,
  );
});

test("recall chat UI persists the active chat URL and refreshes history after completion", () => {
  assert.match(source, /onFinish\(\) \{/);
  assert.match(source, /window\.history\.replaceState\(null, "", `\/chat\?chat=\$\{selectedChatId\}`\)/);
  assert.match(source, /router\.refresh\(\)/);
  assert.match(source, /<button type="button" disabled=\{isWorking\} onClick=\{handleNewChat\}>/);
});

test("recall chat renders message text parts", () => {
  assert.match(source, /messages\.map\(\(message\)/);
  assert.match(source, /message\.parts\.map\(\(part, index\)/);
  assert.match(source, /part\.type === "text"/);
  assert.match(source, /\{part\.text\}/);
});

test("recall chat exposes accessible empty, streaming, error, and ask states", () => {
  assert.match(source, /href="\/"/);
  assert.match(source, /aria-label="Ask Recall"/);
  assert.match(source, /Ask Recall/);
  assert.match(source, /Ask about meetings, people, promises, or anything you remember vaguely/);
  assert.match(source, /status === "streaming" \|\| status === "submitted"/);
  assert.match(source, /Recall is thinking/);
  assert.match(source, /error/);
  assert.match(source, /Recall could not answer safely/);
});

test("recall chat styles are responsive focused chat styles", () => {
  assert.match(styles, /--surface-chat:/);
  assert.match(styles, /--surface-chat-user:/);
  assert.match(styles, /--text-error:/);
  assert.match(styles, /--border-error:/);
  assert.match(styles, /\.chat-page/);
  assert.match(styles, /\.chat-shell/);
  assert.match(styles, /\.recall-thread/);
  assert.match(styles, /\.chat-message/);
  assert.match(styles, /\.chat-form/);
  assert.doesNotMatch(styles, /\.chat-message-body[\s\S]{0,220}background: #[0-9a-f]{6};/i);
  assert.doesNotMatch(styles, /\.chat-error[\s\S]{0,180}#[0-9a-f]{6};/i);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.chat-shell/);
});
