export type ConversationFilterType = "conversation" | "note" | "task" | "mention";
export type ConversationFilterTab = "All" | "Conversations" | "Notes" | "Tasks" | "Mentions";

export type FilterableConversation = {
  type: ConversationFilterType;
};

const tabTypes: Record<Exclude<ConversationFilterTab, "All">, ConversationFilterType> = {
  Conversations: "conversation",
  Notes: "note",
  Tasks: "task",
  Mentions: "mention",
};

export function filterConversationsByTab<TConversation extends FilterableConversation>(
  conversations: TConversation[],
  activeTab: ConversationFilterTab,
) {
  if (activeTab === "All") return conversations;

  return conversations.filter((conversation) => conversation.type === tabTypes[activeTab]);
}
