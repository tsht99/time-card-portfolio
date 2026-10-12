import { createAdminRouteDataToken } from "../../../../lib/server/admin-route-data-token";
import { AdminRouteDataReadiness } from "../../_components/admin-route-data-readiness.tsx";
import { loadAdminUsers } from "../../_lib/admin-user-management.ts";
import type { AttendanceNavigationSearchParams } from "../_lib/attendance-navigation.ts";
import { getAttendanceCreationNavigationLinks } from "../_lib/attendance-navigation.ts";
import { AttendanceCreation } from "./_components/attendance-creation.tsx";

export default async function AttendanceCreationPage({
  searchParams,
}: {
  searchParams?: Promise<AttendanceNavigationSearchParams>;
}) {
  const [resolvedSearchParams, initialUsers] = await Promise.all([
    searchParams ?? Promise.resolve({} as AttendanceNavigationSearchParams),
    loadAdminUsers(),
  ]);
  const navigation = getAttendanceCreationNavigationLinks(resolvedSearchParams);
  const routeDataToken = createAdminRouteDataToken();

  return (
    <AdminRouteDataReadiness
      routeDataToken={routeDataToken}
      ready={initialUsers.status === "ready"}
    >
      <AttendanceCreation
        initialUsers={initialUsers}
        canonicalQuery={navigation.canonicalQuery}
      />
    </AdminRouteDataReadiness>
  );
}
