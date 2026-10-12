import { getCurrentMonth } from "../../../lib/month";
import { parseMonthQuery } from "../../../lib/month-query-state";
import { resolveAuthenticatedUserSession } from "../../../lib/server/auth-session";
import { getServerReferenceTime } from "../../../lib/server/reference-time";
import { StaffAuthScopeBoundary } from "../_components/staff-auth-scope-boundary.tsx";
import { loadStaffAttendanceHistory } from "../_lib/staff-attendance";
import { HistoryClient } from "./_components/history-client.tsx";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const serverReferenceTime = getServerReferenceTime();
  const initialAuth = await resolveAuthenticatedUserSession();
  const selectedMonth =
    parseMonthQuery((await searchParams).month) ??
    getCurrentMonth(serverReferenceTime);
  const initialAttendanceHistory =
    initialAuth.status === "ready"
      ? await loadStaffAttendanceHistory(
          { userId: initialAuth.user.userId },
          selectedMonth,
        )
      : null;

  return (
    <StaffAuthScopeBoundary initialAuth={initialAuth}>
      <HistoryClient
        initialAuth={initialAuth}
        selectedMonth={selectedMonth}
        initialAttendanceHistory={initialAttendanceHistory}
      />
    </StaffAuthScopeBoundary>
  );
}
