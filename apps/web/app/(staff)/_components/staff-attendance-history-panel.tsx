import type { StaffAttendanceItem } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import type { MonthlyRow } from "../../../lib/monthly-attendance-view-model";
import { compareAttendances } from "../../../lib/staff-attendance-order";
import {
  formatStaffClockOutTime,
  formatTime,
} from "../../../lib/staff-date-time";
import { MonthNavigation } from "../../_components/month-navigation.tsx";

function AttendanceHistoryRow({
  attendance,
}: {
  attendance: StaffAttendanceItem;
}) {
  const clockOut =
    attendance.clockOutAt === null
      ? "勤務中"
      : formatStaffClockOutTime(
          attendance.clockOutAt,
          attendance.attendanceDate,
        );
  return (
    <div className="grid w-full grid-cols-[2.5rem_3.5rem_minmax(0,1fr)] items-center gap-x-1 py-3 text-left text-sm">
      <span className="font-medium text-zinc-600">
        {Number(attendance.attendanceDate.slice(8))}日
      </span>
      <WorkPeriodLabel workPeriod={attendance.workPeriod} />
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-1 tabular-nums">
        <span className="whitespace-nowrap text-right">
          {formatTime(attendance.clockInAt)}
        </span>
        <span aria-hidden="true">→</span>
        <span className="whitespace-nowrap text-left">{clockOut}</span>
      </span>
    </div>
  );
}

export function StaffAttendanceHistoryPanel({
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
  const hasHistoryRows = attendanceHistory.length > 0;
  const showEmptyState =
    hasHistorySnapshot &&
    !hasHistoryRows &&
    !isRefreshing &&
    historyError === null;

  return (
    <section
      className="rounded-md border border-zinc-200 bg-white p-4"
      aria-live="polite"
      aria-busy={isRefreshing}
    >
      <MonthNavigation
        selectedMonth={selectedMonth}
        ariaLabel="月次勤怠の月ナビゲーション"
        onMonthChange={onMonthChange}
      />
      {historyError ? (
        <Alert className="mt-3" variant="destructive">
          <AlertDescription>
            <p>
              {hasHistorySnapshot ? "勤怠の更新に失敗しました。" : historyError}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={onRetry}
            >
              再試行
            </Button>
          </AlertDescription>
        </Alert>
      ) : isRefreshing ? (
        <p className="mt-3 text-sm text-zinc-500" role="status">
          {hasHistorySnapshot ? "勤怠履歴を更新中" : "勤怠履歴を読み込み中"}
        </p>
      ) : null}
      {showEmptyState ? (
        <p className="mt-3 text-sm text-zinc-500">この月の打刻はありません。</p>
      ) : hasHistoryRows ? (
        <div className="mt-3 grid gap-3">
          {attendanceHistory.map(({ date, attendance }) => (
            <div key={date} className="divide-y divide-zinc-100">
              {[...attendance.day, ...attendance.night]
                .sort(compareAttendances)
                .map((item) => (
                  <AttendanceHistoryRow
                    key={item.attendanceId}
                    attendance={item}
                  />
                ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
