import { canManageTargetUserData } from "@repo/users";
import type { AdminUserListState } from "../../_lib/admin-user-management-types.ts";

export function canEditAttendanceTarget(
  initialUsers: AdminUserListState,
  currentUserId: string,
  targetUserId: string,
) {
  if (initialUsers.status !== "ready") return false;

  const targetUser = initialUsers.data.find(
    (user) => user.userId === targetUserId,
  );
  if (!targetUser) return false;

  return canManageTargetUserData(
    currentUserId,
    targetUser.userId,
    targetUser.role,
  );
}
