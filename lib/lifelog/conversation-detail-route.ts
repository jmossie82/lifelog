const DASHBOARD_BACK_PARAM_KEYS = ["q", "type", "range", "page"] as const;

export function readFirstSearchParam(
  value: string | string[] | undefined,
): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function buildConversationBackHref(
  params: Record<string, string | string[] | undefined>,
): string {
  const from = readFirstSearchParam(params.from);
  if (!from.startsWith("?")) return "/";

  const incoming = new URLSearchParams(from);
  const outgoing = new URLSearchParams();

  for (const key of DASHBOARD_BACK_PARAM_KEYS) {
    const value = incoming.get(key);
    if (value) {
      outgoing.set(key, value);
    }
  }

  const query = outgoing.toString();
  return query ? `/?${query}` : "/";
}
