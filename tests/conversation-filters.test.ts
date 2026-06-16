import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterConversationsByTab,
  type ConversationFilterType,
} from "../lib/fieldy/conversation-filters.ts";

const conversations: Array<{ id: string; type: ConversationFilterType }> = [
  { id: "standup", type: "conversation" },
  { id: "design-note", type: "note" },
  { id: "investor-prep", type: "task" },
  { id: "customer-mention", type: "mention" },
];

test("maps the Tasks tab to task conversation entries", () => {
  assert.deepEqual(filterConversationsByTab(conversations, "Tasks"), [
    { id: "investor-prep", type: "task" },
  ]);
});

test("maps each visible filter tab to the matching conversation type", () => {
  assert.deepEqual(
    filterConversationsByTab(conversations, "Conversations").map((conversation) => conversation.id),
    ["standup"],
  );
  assert.deepEqual(
    filterConversationsByTab(conversations, "Notes").map((conversation) => conversation.id),
    ["design-note"],
  );
  assert.deepEqual(
    filterConversationsByTab(conversations, "Mentions").map((conversation) => conversation.id),
    ["customer-mention"],
  );
});

test("keeps all conversations visible for the All tab", () => {
  assert.equal(filterConversationsByTab(conversations, "All"), conversations);
});
