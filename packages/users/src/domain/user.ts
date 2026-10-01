const userRoles = ["staff", "admin"] as const;
const userStatuses = ["pending", "active", "inactive"] as const;

export type UserRole = (typeof userRoles)[number];
export type UserStatus = (typeof userStatuses)[number];

export const MAX_DISPLAY_NAME_CODE_POINTS = 100;

export function normalizeDisplayName(value: string): string | null {
  const normalized = value.trim();
  return normalized &&
    Array.from(normalized).length <= MAX_DISPLAY_NAME_CODE_POINTS
    ? normalized
    : null;
}

/** The user state needed to make access and management decisions. */
export type UserState = {
  userId: string;
  role: UserRole;
  status: UserStatus;
  displayName: string | null;
};

export function isUserRole(value: unknown): value is UserRole {
  return userRoles.includes(value as UserRole);
}

export function isUserStatus(value: unknown): value is UserStatus {
  return userStatuses.includes(value as UserStatus);
}

export function isActiveUser(status: UserStatus): boolean {
  return status === "active";
}

export function isActiveAdmin(role: UserRole, status: UserStatus): boolean {
  return role === "admin" && isActiveUser(status);
}

function canTransitionUserStatus(
  currentStatus: UserStatus,
  targetStatus: UserStatus,
): boolean {
  if (targetStatus === "pending") return false;
  if (currentStatus === targetStatus) return true;
  return (
    (currentStatus === "pending" && targetStatus === "active") ||
    (currentStatus === "active" && targetStatus === "inactive") ||
    (currentStatus === "inactive" && targetStatus === "active")
  );
}

/** Attendance management is one use of the active-admin access policy. */
export function canManageAttendance(
  role: UserRole,
  status: UserStatus,
): boolean {
  return isActiveAdmin(role, status);
}

/** Staff data is manageable; an admin may manage only their own data. */
export function canManageTargetUserData(
  actorUserId: string,
  targetUserId: string,
  targetRole: unknown,
): boolean {
  return (
    targetRole === "staff" ||
    (targetRole === "admin" && actorUserId === targetUserId)
  );
}

/** A staff member outside pending must have a display name with content. */
function staffDisplayNameFailure(
  user: Pick<UserState, "role" | "status" | "displayName">,
): "display-name-required" | "display-name-too-long" | null {
  if (user.role !== "staff" || user.status === "pending") return null;
  if (!user.displayName?.trim()) return "display-name-required";
  return normalizeDisplayName(user.displayName)
    ? null
    : "display-name-too-long";
}

export type ChangeStaffStatusResult =
  | { ok: true; user: UserState }
  | {
      ok: false;
      reason:
        | "role-forbidden"
        | "transition-forbidden"
        | "display-name-required"
        | "display-name-too-long";
    };

export function changeStaffStatus(
  user: UserState,
  targetStatus: UserStatus,
): ChangeStaffStatusResult {
  if (user.role !== "staff") return { ok: false, reason: "role-forbidden" };
  if (!canTransitionUserStatus(user.status, targetStatus))
    return { ok: false, reason: "transition-forbidden" };

  const updatedUser = { ...user, status: targetStatus };
  const displayNameFailure = staffDisplayNameFailure(updatedUser);
  if (displayNameFailure) return { ok: false, reason: displayNameFailure };
  return { ok: true, user: updatedUser };
}

/** Administrator edits reuse the shared display-name normalizer. */
function normalizeManagedDisplayName(
  value: string,
):
  | { ok: true; displayName: string }
  | { ok: false; reason: "display-name-required" | "display-name-too-long" } {
  const displayName = normalizeDisplayName(value);
  if (!displayName && value.trim())
    return { ok: false, reason: "display-name-too-long" };
  return displayName
    ? { ok: true, displayName }
    : { ok: false, reason: "display-name-required" };
}

export type ChangeManagedDisplayNameResult =
  | { ok: true; user: UserState & { displayName: string } }
  | {
      ok: false;
      reason:
        | "role-forbidden"
        | "display-name-required"
        | "display-name-too-long";
    };

export function changeManagedDisplayName(
  actorUserId: string,
  user: UserState,
  value: string,
): ChangeManagedDisplayNameResult {
  if (!canManageTargetUserData(actorUserId, user.userId, user.role))
    return { ok: false, reason: "role-forbidden" };
  const normalized = normalizeManagedDisplayName(value);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    user: { ...user, displayName: normalized.displayName },
  };
}
