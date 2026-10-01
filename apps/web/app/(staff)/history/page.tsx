import { yearMonthSchema } from "@repo/contracts";
import { getCurrentMonth } from "../../../lib/month";
import { resolveStaffAuthSession } from "../../../lib/server/auth-session";
import { getServerReferenceTime } from "../../../lib/server/reference-time";
import { loadStaffAttendanceHistory } from "../../../lib/server/staff-attendance";
import { HistoryClient } from "./history-client.tsx";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const serverReferenceTime = getServerReferenceTime();
  const initialAuth = await resolveStaffAuthSession();
  const month = (await searchParams).month;
  const selectedMonth =
    typeof month === "string" && yearMonthSchema.safeParse(month).success
      ? month
      : getCurrentMonth(serverReferenceTime);
  const initialAttendanceHistory =
    initialAuth.status === "ready"
      ? await loadStaffAttendanceHistory(initialAuth.user.userId, selectedMonth)
      : null;

  return (
    <HistoryClient
      initialAuth={initialAuth}
      selectedMonth={selectedMonth}
      initialAttendanceHistory={initialAttendanceHistory}
    />
  );
}
