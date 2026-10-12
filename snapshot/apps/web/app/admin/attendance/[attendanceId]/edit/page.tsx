import { createAdminRouteDataToken } from "../../../../../lib/server/admin-route-data-token";
import { AdminRouteDataReadiness } from "../../../_components/admin-route-data-readiness.tsx";
import { loadAdminUsers } from "../../../_lib/admin-user-management.ts";
import { loadAdminAttendanceDetail } from "../../_lib/admin-attendance";
import {
  type AttendanceNavigationSearchParams,
  getAttendanceNavigationLinks,
} from "../../_lib/attendance-navigation.ts";
import { AttendanceCorrection } from "./_components/attendance-correction.tsx";

export default async function AttendanceCorrectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ attendanceId: string }>;
  searchParams?: Promise<AttendanceNavigationSearchParams>;
}) {
  const { attendanceId } = await params;
  const [resolvedSearchParams, initialDetail, initialUsers] = await Promise.all(
    [
      searchParams ?? Promise.resolve({} as AttendanceNavigationSearchParams),
      loadAdminAttendanceDetail(attendanceId),
      loadAdminUsers(),
    ],
  );
  const { detailHref } = getAttendanceNavigationLinks(
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
      <AttendanceCorrection
        initialDetail={initialDetail}
        initialUsers={initialUsers}
        detailHref={detailHref}
      />
    </AdminRouteDataReadiness>
  );
}
