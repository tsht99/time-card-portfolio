import { resolveAuthenticatedUserSession } from "../../../lib/server/auth-session";
import { getServerReferenceTime } from "../../../lib/server/reference-time";
import { StaffAuthScopeBoundary } from "../_components/staff-auth-scope-boundary.tsx";
import { StaffPage } from "../_components/staff-page.tsx";
import { loadStaffCurrentAttendance } from "../_lib/staff-attendance";

export default async function ClockPage() {
  const serverReferenceTime = getServerReferenceTime();
  const initialAuth = await resolveAuthenticatedUserSession();
  const initialCurrentAttendance =
    initialAuth.status === "ready"
      ? await loadStaffCurrentAttendance(
          { userId: initialAuth.user.userId },
          serverReferenceTime,
        )
      : null;

  return (
    <StaffAuthScopeBoundary initialAuth={initialAuth}>
      <StaffPage
        initialAuth={initialAuth}
        initialCurrentAttendance={initialCurrentAttendance}
      />
    </StaffAuthScopeBoundary>
  );
}
