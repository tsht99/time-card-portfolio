import { createAdminRouteDataToken } from "../../../../../../lib/server/admin-route-data-token";
import { AdminRouteDataReadiness } from "../../../../_components/admin-route-data-readiness.tsx";
import { loadAdminUsers } from "../../../../_lib/admin-user-management.ts";
import { loadAdminHourlyWageRules } from "../_lib/admin-hourly-wage-rules.ts";
import { HourlyWageRuleHistory } from "./_components/hourly-wage-rule-history";

export default async function HourlyWageRuleHistoryPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const [{ userId }, initialUsers] = await Promise.all([
    params,
    loadAdminUsers(),
  ]);
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
      <HourlyWageRuleHistory
        key={userId}
        initialUsers={initialUsers}
        userId={userId}
        hourlyWageRulesState={hourlyWageRulesState}
      />
    </AdminRouteDataReadiness>
  );
}
