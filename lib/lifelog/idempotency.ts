import { createHash } from "node:crypto";

import type { FieldyTask, FieldyTranscription } from "../fieldy/types.ts";

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortStable(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, item]) => [key, sortStable(item)]),
    );
  }

  return value;
}

export function hashStableValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortStable(value)))
    .digest("hex")
    .slice(0, 24);
}

export function deriveFieldySegmentId(
  conversationId: string,
  segment: FieldyTranscription,
): string {
  if (segment.id) {
    return segment.id;
  }

  return `derived-segment-${conversationId}-${hashStableValue({
    text: segment.text,
    speaker: segment.speaker ?? null,
    start: segment.start ?? null,
    end: segment.end ?? null,
    timestamp: segment.timestamp ?? null,
  })}`;
}

export function deriveFieldyTaskId(
  conversationId: string,
  task: FieldyTask,
): string {
  if (task.id) {
    return task.id;
  }

  return `derived-task-${conversationId}-${hashStableValue({
    title: task.title,
    date: task.date ?? null,
    status: task.status,
  })}`;
}
