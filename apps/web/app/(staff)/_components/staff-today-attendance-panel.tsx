import type { StaffAttendanceItem } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import { compareAttendances } from "../../../lib/staff-attendance-order";
import {
  formatStaffClockOutTime,
  formatTime,
} from "../../../lib/staff-date-time";

function TodayAttendanceRow({
  attendance,
}: {
  attendance: StaffAttendanceItem;
}) {
  return (
    <div className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-3 py-3 text-sm">
      <WorkPeriodLabel workPeriod={attendance.workPeriod} />
      <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-1 tabular-nums">
        <span className="whitespace-nowrap text-right">
          {formatTime(attendance.clockInAt)}
        </span>
        <span aria-hidden="true">→</span>
        <span className="whitespace-nowrap text-left">
          {attendance.clockOutAt === null
            ? "勤務中"
            : formatStaffClockOutTime(
                attendance.clockOutAt,
                attendance.attendanceDate,
              )}
        </span>
      </span>
    </div>
  );
}

export function StaffTodayAttendancePanel({
  attendances,
}: {
  attendances: readonly StaffAttendanceItem[] | null;
}) {
  return (
    <section
      className="rounded-md border border-zinc-200 bg-white p-4"
      aria-labelledby="staff-today-attendance-heading"
    >
      <h2
        id="staff-today-attendance-heading"
        className="text-base font-semibold"
      >
        今日の勤怠
      </h2>
      {attendances === null ? (
        <Alert className="mt-3" variant="destructive">
          <AlertDescription>今日の勤怠を確認できません。</AlertDescription>
        </Alert>
      ) : attendances.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">今日の打刻はありません。</p>
      ) : (
        <div className="mt-3 divide-y divide-zinc-100">
          {[...attendances].sort(compareAttendances).map((attendance) => (
            <TodayAttendanceRow
              key={attendance.attendanceId}
              attendance={attendance}
            />
          ))}
        </div>
      )}
    </section>
  );
}
