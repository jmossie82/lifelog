import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

export function createSupabaseAdminClient() {
  const { supabaseUrl, supabaseServiceRoleKey } = getSupabaseAdminEnv();

  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
