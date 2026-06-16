function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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

export function getFieldyEnv() {
  const configuredDays = process.env.FIELDY_BACKFILL_DAYS ?? "30";
  const fieldyBackfillDays = Number.parseInt(configuredDays, 10);

  if (!Number.isInteger(fieldyBackfillDays) || fieldyBackfillDays < 1) {
    throw new Error("FIELDY_BACKFILL_DAYS must be a positive integer");
  }

  return {
    fieldyApiKey: readRequiredEnv("FIELDY_API_KEY"),
    fieldyWebhookSecret: readRequiredEnv("FIELDY_WEBHOOK_SECRET"),
    fieldyBackfillDays,
  };
}

export function getOwnerUserId() {
  return readRequiredEnv("LIFELOG_OWNER_USER_ID");
}
