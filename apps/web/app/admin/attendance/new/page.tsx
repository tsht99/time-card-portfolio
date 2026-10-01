import { loadAdminUsers } from "../../../../lib/server/admin-user-management";
import type { AttendanceNavigationSearchParams } from "../attendance-navigation";
import { getAttendanceCreationNavigationLinks } from "../attendance-navigation";
import { AttendanceCreation } from "./attendance-creation";

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

  return (
    <AttendanceCreation
      initialUsers={initialUsers}
      canonicalQuery={navigation.canonicalQuery}
    />
  );
}
