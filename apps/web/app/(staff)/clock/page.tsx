import { resolveStaffAuthSession } from "../../../lib/server/auth-session";
import { getServerReferenceTime } from "../../../lib/server/reference-time";
import { loadStaffCurrentAttendance } from "../../../lib/server/staff-attendance";
import { StaffPage } from "../_components/staff-page.tsx";
import { StaffQueryProvider } from "../_components/staff-query-provider.tsx";

export default async function ClockPage() {
  const serverReferenceTime = getServerReferenceTime();
  const initialAuth = await resolveStaffAuthSession();
  const initialCurrentAttendance =
    initialAuth.status === "ready"
      ? await loadStaffCurrentAttendance(
          initialAuth.user.userId,
          serverReferenceTime,
        )
      : null;

  return (
    <StaffQueryProvider>
      <StaffPage
        initialAuth={initialAuth}
        initialCurrentAttendance={initialCurrentAttendance}
      />
    </StaffQueryProvider>
  );
}
