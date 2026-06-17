"use server";

import { revalidatePath } from "next/cache";

import { getFieldyEnv, getOwnerUserId } from "@/lib/env";
import { createFieldyClient } from "@/lib/fieldy/client";
import type { BackfillActionState } from "@/lib/lifelog/backfill-action-state";
import { createIngestionService } from "@/lib/lifelog/ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runFieldyBackfill } from "./backfill-fieldy-core";

type BackfillActionReturn<TFormData> = Promise<
  TFormData extends FormData ? BackfillActionState : void
>;

export async function backfillFieldy<
  TFormData extends FormData | undefined = undefined,
>(
  _prevStateOrFormData: BackfillActionState | FormData,
  _formData?: TFormData,
): BackfillActionReturn<TFormData> {
  const formData = _formData ?? _prevStateOrFormData;
  const shouldReturnState = _formData !== undefined;
  void formData;

  const result = await runFieldyBackfill({
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

  if (
    result.ok &&
    "importedCount" in result &&
    typeof result.importedCount === "number"
  ) {
    if (shouldReturnState) {
      return {
        status: "success",
        message: `Imported ${result.importedCount} Fieldy rows.`,
        importedCount: result.importedCount,
      } as Awaited<BackfillActionReturn<TFormData>>;
    }

    return undefined as Awaited<BackfillActionReturn<TFormData>>;
  }

  const message =
    "error" in result && typeof result.error === "string"
      ? result.error
      : "Fieldy backfill failed";

  if (shouldReturnState) {
    return {
      status: "error",
      message,
      importedCount: null,
    } as Awaited<BackfillActionReturn<TFormData>>;
  }

  return undefined as Awaited<BackfillActionReturn<TFormData>>;
}
