import { getCurrentMonth } from "../../../../lib/month";
import { createAdminRouteDataToken } from "../../../../lib/server/admin-route-data-token";
import { getServerReferenceTime } from "../../../../lib/server/reference-time";
import { AdminRouteDataReadiness } from "../../_components/admin-route-data-readiness.tsx";
import { loadAdminUsers } from "../../_lib/admin-user-management.ts";
import { UserDetail } from "./_components/user-detail";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const initialUsers = await loadAdminUsers();
  const routeDataToken = createAdminRouteDataToken();

  return (
    <AdminRouteDataReadiness
      routeDataToken={routeDataToken}
      ready={
        initialUsers.status === "ready" &&
        initialUsers.data.some((user) => user.userId === userId)
      }
    >
      <UserDetail
        key={userId}
        initialUsers={initialUsers}
        userId={userId}
        currentMonth={getCurrentMonth(getServerReferenceTime())}
      />
    </AdminRouteDataReadiness>
  );
}
