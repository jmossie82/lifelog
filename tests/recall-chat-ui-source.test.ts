import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("components/recall-chat.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

test("recall chat uses AI SDK 5 transport to the recall route", () => {
  assert.match(source, /"use client";/);
  assert.match(source, /import \{ DefaultChatTransport \} from "ai";/);
  assert.match(source, /import \{ useChat \} from "@ai-sdk\/react";/);
  assert.match(source, /useChat\(\{\s*transport\s*\}\)/);
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
  assert.match(styles, /\.chat-page/);
  assert.match(styles, /\.chat-shell/);
  assert.match(styles, /\.recall-thread/);
  assert.match(styles, /\.chat-message/);
  assert.match(styles, /\.chat-form/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.chat-shell/);
});
