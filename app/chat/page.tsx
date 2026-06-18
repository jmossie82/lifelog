import { redirect } from "next/navigation";
import { RecallChat } from "@/components/recall-chat";
import { getOwnerUserId } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ChatPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  if (user.id !== getOwnerUserId()) {
    redirect("/login?error=invalid_credentials");
  }

  return <RecallChat />;
}
