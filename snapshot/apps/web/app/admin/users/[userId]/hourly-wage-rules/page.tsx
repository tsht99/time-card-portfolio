import { createHourlyWageRuleRequestSchema } from "@repo/contracts";
import { redirect } from "next/navigation";
import { createAdminRouteDataToken } from "../../../../../lib/server/admin-route-data-token";
import { AdminRouteDataReadiness } from "../../../_components/admin-route-data-readiness.tsx";
import { loadAdminUsers } from "../../../_lib/admin-user-management.ts";
import { HourlyWageRulesClient } from "./_components/hourly-wage-rules-client.tsx";
import { loadAdminHourlyWageRules } from "./_lib/admin-hourly-wage-rules.ts";

export default async function UserHourlyWageRulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<{ date?: string | string[] }>;
}) {
  const [{ userId }, resolvedSearchParams, initialUsers] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as { date?: string | string[] }),
    loadAdminUsers(),
  ]);
  const requestedDate = resolvedSearchParams.date;
  if (
    requestedDate !== undefined &&
    (typeof requestedDate !== "string" ||
      !createHourlyWageRuleRequestSchema.shape.effectiveFrom.safeParse(
        requestedDate,
      ).success)
  ) {
    redirect(`/admin/users/${encodeURIComponent(userId)}/hourly-wage-rules`);
  }
  const hourlyWageRulesState = await loadAdminHourlyWageRules(userId);
  const routeDataToken = createAdminRouteDataToken();
  return (
    <AdminRouteDataReadiness
      routeDataToken={routeDataToken}
      ready={
        initialUsers.status === "ready" &&
        initialUsers.data.some((user) => user.userId === userId) &&
        hourlyWageRulesState.status === "ready"
      }
    >
      <HourlyWageRulesClient
        key={`${userId}:${requestedDate ?? "current"}`}
        initialUsers={initialUsers}
        selectedUserId={userId}
        initialReferenceDate={requestedDate}
        hourlyWageRulesState={hourlyWageRulesState}
      />
    </AdminRouteDataReadiness>
  );
}
