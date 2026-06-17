import type {
  FieldyConversation,
  FieldyPage,
  FieldyTask,
  FieldyTaskStatus,
  FieldyTranscription,
} from "@/lib/fieldy/types";

const FIELDY_API_BASE_URL = "https://api.fieldy.ai/api/public/v2";
const FIELDY_TASK_STATUSES: FieldyTaskStatus[] = [
  "new",
  "approved",
  "completed",
  "rejected",
  "skipped",
  "cancelled",
  "expired",
];

type FetchImpl = typeof fetch;

type FieldyClientOptions = {
  apiKey: string;
  fetchImpl?: FetchImpl;
  fallbackRetryDelayMs?: number;
  minRequestSpacingMs?: number;
  sleepImpl?: (ms: number) => Promise<unknown>;
};

type ConversationRange = {
  startTime: string;
  endTime: string;
  mode?: "starts-in-range" | "intersects-range";
};

type TranscriptionRange = {
  startTime: string;
  endTime?: string;
};

export class FieldyApiError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createFieldyClient({
  apiKey,
  fetchImpl = fetch,
  fallbackRetryDelayMs = 60_000,
  minRequestSpacingMs = 0,
  sleepImpl = sleep,
}: FieldyClientOptions) {
  let lastRequestAt = 0;

  async function waitForRequestSlot() {
    if (minRequestSpacingMs <= 0) return;

    const elapsedMs = Date.now() - lastRequestAt;
    if (elapsedMs < minRequestSpacingMs) {
      await sleepImpl(minRequestSpacingMs - elapsedMs);
    }
  }

  async function requestJson<TResponse>(path: string, params: URLSearchParams) {
    const url = new URL(`${FIELDY_API_BASE_URL}${path}`);
    params.forEach((value, key) => url.searchParams.set(key, value));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await waitForRequestSlot();
      const response = await fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      lastRequestAt = Date.now();

      if (response.status === 429 && attempt === 0) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = retryAfterHeader?.trim()
          ? Number(retryAfterHeader)
          : Number.NaN;
        const cooldownMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? retryAfterSeconds * 1000
          : fallbackRetryDelayMs;
        await sleepImpl(cooldownMs);
        continue;
      }

      if (!response.ok) {
        throw new FieldyApiError(`Fieldy API request failed with ${response.status}`, response.status);
      }

      return (await response.json()) as TResponse;
    }

    throw new FieldyApiError("Fieldy API request failed with 429", 429);
  }

  function requestPage<TItem>(path: string, params: URLSearchParams) {
    return requestJson<FieldyPage<TItem>>(path, params);
  }

  async function collectPages<TItem>(path: string, params: URLSearchParams) {
    const items: TItem[] = [];
    let cursor: string | null | undefined;

    do {
      if (cursor) {
        params.set("cursor", cursor);
      } else {
        params.delete("cursor");
      }

      const page = await requestPage<TItem>(path, params);
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    return items;
  }

  return {
    fetchConversations(range: ConversationRange) {
      const params = new URLSearchParams({
        startTime: range.startTime,
        endTime: range.endTime,
        pageSize: "50",
      });
      if (range.mode) {
        params.set("mode", range.mode);
      }
      return collectPages<FieldyConversation>("/conversations", params);
    },

    fetchTranscriptions(range: TranscriptionRange) {
      const params = new URLSearchParams({
        startTime: range.startTime,
        pageSize: "1000",
      });
      if (range.endTime) {
        params.set("endTime", range.endTime);
      }
      return collectPages<FieldyTranscription>("/transcriptions", params);
    },

    async fetchTasks() {
      const allTasks: FieldyTask[] = [];
      for (const status of FIELDY_TASK_STATUSES) {
        const params = new URLSearchParams({ status });
        const tasks = await collectPages<FieldyTask>("/tasks", params);
        allTasks.push(...tasks);
      }
      return allTasks;
    },
  };
}

export { FIELDY_TASK_STATUSES };
