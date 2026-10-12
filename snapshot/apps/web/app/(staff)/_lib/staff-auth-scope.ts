import type { AuthBootstrapState } from "../../../lib/auth-types";

/**
 * Keep client state across refreshes for the same active user, while forcing
 * the staff screen subtree to remount whenever its authentication scope changes.
 */
export function getStaffAuthScopeKey(auth: AuthBootstrapState): string {
  return auth.status === "ready"
    ? `ready:${auth.user.userId}`
    : `auth:${auth.status}`;
}
