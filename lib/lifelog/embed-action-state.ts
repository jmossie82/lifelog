export type EmbedConversationsActionState = {
  status: "idle" | "success" | "error";
  message: string;
  embeddedCount: number | null;
  skippedCount: number | null;
};

export const initialEmbedConversationsActionState: EmbedConversationsActionState = {
  status: "idle",
  message: "",
  embeddedCount: null,
  skippedCount: null,
};
