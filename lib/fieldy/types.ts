export type FieldyConversationPayload = {
  id: string;
  title?: string;
  summary?: string;
  content?: string;
  keywords?: string[];
  startTime?: string;
  endTime?: string;
};

export type FieldyWebhookPayload = {
  type?: string;
  conversation?: FieldyConversationPayload;
  transcriptions?: unknown[];
  tasks?: unknown[];
};
