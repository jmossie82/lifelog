export const DASHBOARD_PAGE_SIZE = 25;
export const DASHBOARD_MAX_PAGE = 20;
export const DASHBOARD_MAX_SEARCH_LENGTH = 200;

export const DASHBOARD_CONVERSATION_FILTER_TYPES = [
  "all",
  "conversation",
  "note",
  "task",
  "mention",
] as const;

export const DASHBOARD_RANGE_FILTERS = ["all", "today", "week"] as const;

export type DashboardConversationFilterType =
  (typeof DASHBOARD_CONVERSATION_FILTER_TYPES)[number];

export type DashboardRangeFilter = (typeof DASHBOARD_RANGE_FILTERS)[number];

export type DashboardQuery = {
  q: string;
  type: DashboardConversationFilterType;
  range: DashboardRangeFilter;
  page: number;
};

type SearchParamsValue = string | string[] | undefined;

function readFirstParam(value: SearchParamsValue) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function isDashboardConversationFilterType(
  value: string,
): value is DashboardConversationFilterType {
  return DASHBOARD_CONVERSATION_FILTER_TYPES.includes(
    value as DashboardConversationFilterType,
  );
}

function isDashboardRangeFilter(value: string): value is DashboardRangeFilter {
  return DASHBOARD_RANGE_FILTERS.includes(value as DashboardRangeFilter);
}

function normalizeSearch(value: SearchParamsValue) {
  return readFirstParam(value).trim().slice(0, DASHBOARD_MAX_SEARCH_LENGTH);
}

function normalizePage(value: SearchParamsValue) {
  const page = Number(readFirstParam(value));
  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }
  return Math.min(page, DASHBOARD_MAX_PAGE);
}

export function normalizeDashboardQuery(
  params: Record<string, SearchParamsValue>,
): DashboardQuery {
  const rawType = readFirstParam(params.type);
  const rawRange = readFirstParam(params.range);

  return {
    q: normalizeSearch(params.q),
    type: isDashboardConversationFilterType(rawType) ? rawType : "all",
    range: isDashboardRangeFilter(rawRange) ? rawRange : "all",
    page: normalizePage(params.page),
  };
}

const POSTGREST_FILTER_GRAMMAR_OR_WILDCARDS = /[\\,.:()"%_*]/g;

function normalizePostgrestIlikePattern(value: string) {
  return value
    .replace(POSTGREST_FILTER_GRAMMAR_OR_WILDCARDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildConversationSearchFilter(q: string) {
  const normalized = normalizePostgrestIlikePattern(q).slice(
    0,
    DASHBOARD_MAX_SEARCH_LENGTH,
  );
  if (!normalized) {
    return null;
  }

  const pattern = `*${normalized}*`;

  return [
    `title.ilike.${pattern}`,
    `summary.ilike.${pattern}`,
    `content.ilike.${pattern}`,
  ].join(",");
}

function getDisplayDateParts(value: Date, displayTimeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: displayTimeZone,
    year: "numeric",
  }).formatToParts(value);

  return {
    day: Number(parts.find((part) => part.type === "day")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
}

function getDisplayDayStart(value: Date, displayTimeZone: string) {
  const { day, month, year } = getDisplayDateParts(value, displayTimeZone);
  const approximateUtcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: displayTimeZone,
    timeZoneName: "longOffset",
  }).formatToParts(approximateUtcNoon);
  const offset =
    offsetParts.find((part) => part.type === "timeZoneName")?.value ??
    "GMT+00:00";
  const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) *
      (Number(match[2]) * 60 + Number(match[3]))
    : 0;

  return new Date(Date.UTC(year, month - 1, day) - offsetMinutes * 60_000);
}

export function getDashboardRangeBounds({
  range,
  displayTimeZone,
  now,
}: {
  range: DashboardRangeFilter;
  displayTimeZone: string;
  now: Date;
}) {
  if (range === "all") {
    return null;
  }

  if (range === "today") {
    const start = getDisplayDayStart(now, displayTimeZone);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    return {
      startedAtGte: start.toISOString(),
      startedAtLt: end.toISOString(),
    };
  }

  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 1);

  return {
    startedAtGte: start.toISOString(),
    startedAtLt: end.toISOString(),
  };
}
