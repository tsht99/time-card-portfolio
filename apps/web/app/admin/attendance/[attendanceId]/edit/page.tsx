import { loadAdminAttendanceDetail } from "../../../../../lib/server/admin-attendance";
import { loadAdminUsers } from "../../../../../lib/server/admin-user-management";
import {
  type AttendanceNavigationSearchParams,
  getAttendanceNavigationLinks,
} from "../../attendance-navigation";
import { AttendanceCorrection } from "./attendance-correction";

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

  return (
    <AttendanceCorrection
      initialDetail={initialDetail}
      initialUsers={initialUsers}
      detailHref={detailHref}
    />
  );
}
