import { redirect } from "next/navigation";
import { LifelogDashboard } from "@/components/lifelog-dashboard";
import { getOwnerUserId } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (user.id !== getOwnerUserId()) {
    redirect("/login?error=invalid_credentials");
  }

  return <LifelogDashboard />;
}
