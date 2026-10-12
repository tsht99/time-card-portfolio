import { createAdminRouteDataToken } from "../../../../lib/server/admin-route-data-token";
import { AdminRouteDataReadiness } from "../../_components/admin-route-data-readiness.tsx";
import { loadAdminUsers } from "../../_lib/admin-user-management.ts";
import { loadAdminAttendanceDetail } from "../_lib/admin-attendance";
import {
  type AttendanceNavigationSearchParams,
  getAttendanceNavigationLinks,
} from "../_lib/attendance-navigation.ts";
import { AttendanceDetail } from "./_components/attendance-detail.tsx";

export default async function AttendanceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ attendanceId: string }>;
  searchParams?: Promise<AttendanceNavigationSearchParams>;
}) {
  const { attendanceId } = await params;
  const [resolvedSearchParams, [initialDetail, initialUsers]] =
    await Promise.all([
      searchParams ?? Promise.resolve({} as AttendanceNavigationSearchParams),
      Promise.all([loadAdminAttendanceDetail(attendanceId), loadAdminUsers()]),
    ]);
  const navigation = getAttendanceNavigationLinks(
    attendanceId,
    resolvedSearchParams,
  );
  const routeDataToken = createAdminRouteDataToken();

  return (
    <AdminRouteDataReadiness
      routeDataToken={routeDataToken}
      ready={
        initialDetail.status === "ready" && initialUsers.status === "ready"
      }
    >
      <AttendanceDetail
        initialDetail={initialDetail}
        initialUsers={initialUsers}
        correctionHref={navigation.correctionHref}
      />
    </AdminRouteDataReadiness>
  );
}
