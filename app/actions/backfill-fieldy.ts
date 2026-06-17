"use server";

import { revalidatePath } from "next/cache";

import { getFieldyEnv, getOwnerUserId } from "@/lib/env";
import { createFieldyClient } from "@/lib/fieldy/client";
import { createIngestionService } from "@/lib/lifelog/ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runFieldyBackfill } from "./backfill-fieldy-core";

export async function backfillFieldy(_formData: FormData): Promise<void> {
  void _formData;

  await runFieldyBackfill({
    getOwnerUserId,
    getCurrentUser: async () => {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      return user;
    },
    getFieldyEnv: () => {
      const { fieldyApiKey, fieldyBackfillDays } = getFieldyEnv();
      return { fieldyApiKey, fieldyBackfillDays };
    },
    createSupabaseAdminClient,
    createFieldyClient,
    createIngestionService,
    revalidatePath,
  });
}
