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
  assert.match(pageSource, /if \(!user\) \{\s*redirect\("\/login"\);/);
  assert.match(pageSource, /user\.id !== getOwnerUserId\(\)/);
  assert.match(pageSource, /redirect\("\/login\?error=invalid_credentials"\)/);
  assert.match(pageSource, /<RecallChat \/>/);
});

test("dashboard primary navigation links Recall to the chat page", () => {
  assert.match(dashboardSource, /\{ label: "Timeline", href: "\/", icon: BarChart3 \}/);
  assert.match(dashboardSource, /\{ label: "Recall", href: "\/chat", icon: MessageSquareText \}/);
  assert.match(dashboardSource, /<Link[\s\S]*href=\{item\.href\}/);
  assert.match(dashboardSource, /item\.label === "Timeline" && pathname === "\/"/);
  assert.match(dashboardSource, /pathname === item\.href/);
  assert.doesNotMatch(dashboardSource, /const isActive = item\.label === "Timeline"/);
  assert.doesNotMatch(
    dashboardSource,
    /label: "Recall"[\s\S]{0,120}<a[\s\S]{0,120}href="#"/,
  );
});
