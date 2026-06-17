export type FieldyWebhookSegment = {
  text: string;
  speaker: string;
  start: number;
  end: number;
  duration: number;
};

export type FieldyWebhookPayload = {
  date: string;
  transcription: string;
  transcriptions: FieldyWebhookSegment[];
};

export type FieldyConversation = {
  id: string;
  title?: string | null;
  summary?: string | null;
  content?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  type?: string | null;
  keywords?: string[] | null;
  speakers?: unknown;
  quotes?: unknown;
  location?: unknown;
  templateId?: string | null;
  calendarEventId?: string | null;
  updatedAt?: string | null;
};

export type FieldyTranscription = {
  id?: string | null;
  text: string;
  timestamp?: string | null;
  speaker?: string | null;
  speakerProfileId?: string | null;
  start?: number | null;
  end?: number | null;
  createdAt?: string | null;
  source?: string | null;
};

export type FieldyTaskStatus =
  | "new"
  | "approved"
  | "completed"
  | "rejected"
  | "skipped"
  | "cancelled"
  | "expired";

export type FieldyTask = {
  id?: string | null;
  title: string;
  date?: string | null;
  status: FieldyTaskStatus;
  memoryId?: string | null;
  completionDate?: string | null;
  cancellationDate?: string | null;
};

export type FieldyPage<TItem> = {
  items: TItem[];
  nextCursor?: string | null;
};
