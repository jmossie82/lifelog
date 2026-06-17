import { redirect } from "next/navigation";
import { LifelogDashboard } from "@/components/lifelog-dashboard";
import { getDisplayTimeZone, getOwnerUserId } from "@/lib/env";
import { getDashboardData } from "@/lib/lifelog/dashboard-data";
import { normalizeDashboardQuery } from "@/lib/lifelog/dashboard-query";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  const displayTimeZone = getDisplayTimeZone();
  const renderedAt = new Date();
  const dashboardQuery = normalizeDashboardQuery(await searchParams);
  const dashboardData = await getDashboardData(supabase, {
    userId: user.id,
    query: dashboardQuery,
    displayTimeZone,
    now: renderedAt,
  });

  return (
    <LifelogDashboard
      data={dashboardData}
      displayTimeZone={displayTimeZone}
      renderedAt={renderedAt.toISOString()}
    />
  );
}
