import { loadAdminAttendanceDetail } from "../../../../lib/server/admin-attendance";
import { loadAdminUsers } from "../../../../lib/server/admin-user-management";
import {
  type AttendanceNavigationSearchParams,
  getAttendanceNavigationLinks,
} from "../attendance-navigation";
import { AttendanceDetail } from "./attendance-detail";

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

  return (
    <AttendanceDetail
      initialDetail={initialDetail}
      initialUsers={initialUsers}
      correctionHref={navigation.correctionHref}
    />
  );
}
