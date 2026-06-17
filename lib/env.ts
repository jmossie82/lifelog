function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const DEFAULT_DISPLAY_TIME_ZONE = "America/Chicago";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

function assertValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new Error("LIFELOG_DISPLAY_TIME_ZONE must be a valid IANA time zone");
  }
}

export function getClientEnv() {
  return {
    supabaseUrl: readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
}

export function getSupabaseAdminEnv() {
  return {
    supabaseUrl: readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceRoleKey: readRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getFieldyWebhookSecret() {
  return readRequiredEnv("FIELDY_WEBHOOK_SECRET");
}

export function getFieldyEnv() {
  const configuredDays = process.env.FIELDY_BACKFILL_DAYS ?? "30";
  const fieldyBackfillDays = Number(configuredDays);

  if (
    !/^\d+$/.test(configuredDays) ||
    !Number.isInteger(fieldyBackfillDays) ||
    fieldyBackfillDays < 1
  ) {
    throw new Error("FIELDY_BACKFILL_DAYS must be a positive integer");
  }

  return {
    fieldyApiKey: readRequiredEnv("FIELDY_API_KEY"),
    fieldyWebhookSecret: getFieldyWebhookSecret(),
    fieldyBackfillDays,
  };
}

export function getOwnerUserId() {
  return readRequiredEnv("LIFELOG_OWNER_USER_ID");
}

export function getDisplayTimeZone() {
  const displayTimeZone = process.env.LIFELOG_DISPLAY_TIME_ZONE ?? DEFAULT_DISPLAY_TIME_ZONE;
  assertValidTimeZone(displayTimeZone);
  return displayTimeZone;
}

export function getOpenAiEmbeddingEnv() {
  const embeddingModel = process.env.LIFELOG_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;

  if (embeddingModel !== DEFAULT_EMBEDDING_MODEL) {
    throw new Error(`LIFELOG_EMBEDDING_MODEL must be ${DEFAULT_EMBEDDING_MODEL}`);
  }

  return {
    openAiApiKey: readRequiredEnv("OPENAI_API_KEY"),
    embeddingModel,
  };
}
