import type { AdminUsersState } from "../../../lib/admin-user-management-types";

export function canEditAttendanceTarget(
  initialUsers: AdminUsersState,
  currentUserId: string,
  targetUserId: string,
) {
  if (initialUsers.status !== "ready") return false;

  const targetUser = initialUsers.data.find(
    (user) => user.userId === targetUserId,
  );
  if (!targetUser) return false;

  return (
    targetUser.role === "staff" ||
    (targetUser.role === "admin" && targetUser.userId === currentUserId)
  );
}
