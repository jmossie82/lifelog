import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const pageSource = readFileSync("app/chat/page.tsx", "utf8");
const dashboardSource = readFileSync("components/lifelog-dashboard.tsx", "utf8");

test("recall chat page enforces owner authentication", () => {
  assert.match(pageSource, /import \{ redirect \} from "next\/navigation";/);
  assert.match(pageSource, /import \{ RecallChat \} from "@\/components\/recall-chat";/);
  assert.match(pageSource, /getOwnerUserId/);
  assert.match(pageSource, /createSupabaseServerClient/);
  assert.match(pageSource, /supabase\.auth\.getUser\(\)/);
  assert.match(pageSource, /error,/);
  assert.match(pageSource, /if \(error \|\| !user\) \{\s*redirect\("\/login"\);/);
  assert.match(pageSource, /user\.id !== getOwnerUserId\(\)/);
  assert.match(pageSource, /redirect\("\/login\?error=invalid_credentials"\)/);
  assert.match(pageSource, /<RecallChat[\s\S]*initialMessages=\{initialMessages\}/);
});

test("recall chat page loads owner sessions and selected stored messages", () => {
  assert.match(pageSource, /searchParams:\s*Promise<Record<string, string \| string\[\] \| undefined>>/);
  assert.match(pageSource, /readFirstSearchParam/);
  assert.match(pageSource, /normalizeRecallChatSessionId/);
  assert.match(pageSource, /getRecallChatSession/);
  assert.match(pageSource, /getRecallChatSessions/);
  assert.match(pageSource, /getRecallChatMessages/);
  assert.match(pageSource, /selectedSession/);
  assert.match(pageSource, /displayedSessions/);
  assert.match(pageSource, /\[selectedSession, \.\.\.initialSessions\]/);
  assert.match(pageSource, /initialSessions=/);
  assert.match(pageSource, /initialMessages=/);
  assert.match(pageSource, /selectedChatId=/);
});

test("dashboard primary navigation links Recall to the chat page", () => {
  assert.match(dashboardSource, /\{ label: "Timeline", href: "\/", icon: BarChart3 \}/);
  assert.match(dashboardSource, /\{ label: "Recall", href: "\/chat", icon: MessageSquareText \}/);
  assert.match(dashboardSource, /\{ label: "Search", href: null, icon: Search \}/);
  assert.match(dashboardSource, /<Link[\s\S]*href=\{item\.href\}/);
  assert.match(dashboardSource, /const isActive = item\.href \? pathname === item\.href : false/);
  assert.match(dashboardSource, /aria-disabled="true"/);
  assert.match(dashboardSource, /className="nav-item is-disabled"/);
  assert.doesNotMatch(dashboardSource, /const isActive = item\.label === "Timeline"/);
  assert.doesNotMatch(dashboardSource, /\{ label: "Search", href: "\/", icon: Search \}/);
  assert.doesNotMatch(
    dashboardSource,
    /label: "Recall"[\s\S]{0,120}<a[\s\S]{0,120}href="#"/,
  );
});
