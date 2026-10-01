import type { MonthlyRow } from "../../../lib/monthly-attendance-view-model";
import { StaffAttendanceHistoryPanel } from "../_components/staff-attendance-history-panel.tsx";
import { StaffScreenFrame } from "../_components/staff-screen-frame.tsx";

export function StaffHistoryView({
  attendanceHistory,
  selectedMonth,
  historyError,
  hasHistorySnapshot,
  isRefreshing,
  onMonthChange,
  onRetry,
}: {
  attendanceHistory: MonthlyRow[];
  selectedMonth: string;
  historyError: string | null;
  hasHistorySnapshot: boolean;
  isRefreshing: boolean;
  onMonthChange: (month: string) => void;
  onRetry: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col px-0 py-0 text-zinc-950">
      <h1 className="sr-only">月次勤怠履歴</h1>
      <StaffScreenFrame active="history">
        <StaffAttendanceHistoryPanel
          attendanceHistory={attendanceHistory}
          selectedMonth={selectedMonth}
          historyError={historyError}
          hasHistorySnapshot={hasHistorySnapshot}
          isRefreshing={isRefreshing}
          onMonthChange={onMonthChange}
          onRetry={onRetry}
        />
      </StaffScreenFrame>
    </main>
  );
}
