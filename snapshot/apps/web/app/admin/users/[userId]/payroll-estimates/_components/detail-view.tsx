// cspell:ignore uncomputed

import type { AdminUserMonthlyPayrollEstimateDetail } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { TriangleAlert } from "lucide-react";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import { formatStaffClockOutTime } from "@/lib/attendance-display-time";
import {
  formatTokyoTime,
  getTokyoDate,
} from "../../../../../../lib/tokyo-date-time";
import { MonthNavigation } from "../../../../../_components/month-navigation.tsx";
import {
  NavigationList,
  NavigationListItem,
} from "../../../../_components/navigation-list.tsx";
import { UserContextCard } from "../../../../_components/user-context-card.tsx";
import type { AdminUserMonthlyPayrollEstimateDetailState } from "../../../../_lib/admin-payroll-estimate-types.ts";

function formatYen(value: number) {
  return `${value.toLocaleString("ja-JP")}円`;
}

function formatWorkedMinutes(value: number | null) {
  if (value === null) return null;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) return `${minutes}分`;
  if (minutes === 0) return `${hours}時間`;
  return `${hours}時間${minutes}分`;
}

function formatAttendanceDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "日付不明";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "日付不明";
  }
  const weekday = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  }).format(date);
  return `${month}/${day}（${weekday}）`;
}

function isValidDateTime(value: string | null): value is string {
  return value !== null && Number.isFinite(new Date(value).getTime());
}

function formatClockInTime(value: string | null) {
  if (!isValidDateTime(value)) return "未登録";
  try {
    return formatTokyoTime(value);
  } catch {
    return "未登録";
  }
}

function formatClockOutTime(
  value: string | null,
  attendanceDate: string,
  status: AdminUserMonthlyPayrollEstimateDetail["attendances"][number]["status"],
) {
  if (status === "clockOutMissing" || !isValidDateTime(value)) return "未登録";
  try {
    const clockOutDate = getTokyoDate(value);
    const [year, month, day] = attendanceDate.split("-").map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
    const nextAttendanceDate = `${nextDate.getUTCFullYear()}-${String(
      nextDate.getUTCMonth() + 1,
    ).padStart(2, "0")}-${String(nextDate.getUTCDate()).padStart(2, "0")}`;
    if (clockOutDate === nextAttendanceDate) {
      const [hours, minutes] = formatTokyoTime(value).split(":");
      return `${Number(hours) + 24}:${minutes}`;
    }
    if (
      clockOutDate !== attendanceDate &&
      clockOutDate !== nextAttendanceDate
    ) {
      const [, monthText, dayText] = clockOutDate.split("-");
      return `${Number(monthText)}/${Number(dayText)} ${formatTokyoTime(value)}`;
    }
    return formatStaffClockOutTime(value, attendanceDate);
  } catch {
    return "未登録";
  }
}

function calculationStatusText(
  attendance: AdminUserMonthlyPayrollEstimateDetail["attendances"][number],
) {
  if (
    attendance.status === "calculated" &&
    attendance.estimatedPayYen !== null
  ) {
    return {
      text: formatYen(attendance.estimatedPayYen),
      className: "text-zinc-950",
    };
  }
  if (attendance.status === "missingHourlyWage") {
    return { text: "時給未設定", className: "text-amber-700" };
  }
  if (attendance.status === "clockOutMissing") {
    return { text: "退勤未記録", className: "text-amber-700" };
  }
  if (attendance.status === "incomplete") {
    return { text: "勤怠不完全", className: "text-amber-700" };
  }
  return { text: "未算出", className: "text-amber-700" };
}

function AttendanceRow({
  attendance,
}: {
  attendance: AdminUserMonthlyPayrollEstimateDetail["attendances"][number];
}) {
  const amount = calculationStatusText(attendance);
  const clockOut = formatClockOutTime(
    attendance.clockOutAt,
    attendance.attendanceDate,
    attendance.status,
  );
  const workedMinutes =
    attendance.status === "clockOutMissing"
      ? null
      : formatWorkedMinutes(attendance.workedMinutes);

  return (
    <NavigationListItem
      href={`/admin/attendance/${encodeURIComponent(attendance.attendanceId)}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="shrink-0 font-medium">
            {formatAttendanceDate(attendance.attendanceDate)}
          </span>
          <WorkPeriodLabel workPeriod={attendance.workPeriod} />
          <span className="shrink-0 text-xs text-zinc-600">
            {attendance.hourlyWage === null
              ? "時給未設定"
              : `${formatYen(attendance.hourlyWage)}/時`}
          </span>
          <span
            className={`ml-auto shrink-0 font-semibold ${amount.className}`}
          >
            {amount.text}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm text-zinc-600">
          <span>
            <span className="sr-only">出退勤時刻 </span>
            {formatClockInTime(attendance.clockInAt)} - {clockOut}
          </span>
          {workedMinutes !== null && (
            <span>
              <span className="sr-only">勤務時間 </span>
              {workedMinutes}
            </span>
          )}
        </div>
      </div>
    </NavigationListItem>
  );
}

function PayrollEstimateDetailContent({
  detail,
  month,
  navigateToMonth,
}: {
  detail: AdminUserMonthlyPayrollEstimateDetail;
  month: string;
  navigateToMonth: (targetMonth: string) => void;
}) {
  const adjustment = detail.roundingAdjustmentYen;

  return (
    <>
      <UserContextCard displayName={detail.displayName} />
      <div className="mt-4 flex min-w-0 w-full justify-center">
        <MonthNavigation
          selectedMonth={month}
          ariaLabel="給与見込み詳細の月ナビゲーション"
          onMonthChange={navigateToMonth}
          allowDirectSelection
        />
      </div>
      <section
        className="mt-4 rounded-md border border-zinc-200 bg-white px-3 py-3"
        aria-label="給与見込み額"
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 max-w-full break-words text-xl font-semibold tabular-nums">
            {formatYen(detail.totalEstimatedPayYen)}
          </p>
          {detail.uncomputedCount > 0 && (
            <span className="inline-flex max-w-full items-center gap-1 break-words rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
              <span>未算出 {detail.uncomputedCount}件</span>
            </span>
          )}
        </div>
      </section>
      {detail.attendances.length === 0 ? (
        <section
          className="mt-4 rounded-md border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-600"
          aria-label="勤怠別給与見込み明細"
        >
          この月の勤怠データはありません
          {adjustment !== 0 && (
            <p className="mt-3 font-medium text-zinc-700">
              端数調整 {adjustment > 0 ? "+" : ""}
              {adjustment.toLocaleString("ja-JP")}円
            </p>
          )}
        </section>
      ) : (
        <NavigationList className="mt-4" aria-label="勤怠別給与見込み明細">
          {detail.attendances.map((attendance) => (
            <AttendanceRow
              key={attendance.attendanceId}
              attendance={attendance}
            />
          ))}
          {adjustment !== 0 && (
            <li className="px-3 py-3 text-sm font-medium text-zinc-700">
              端数調整 {adjustment > 0 ? "+" : ""}
              {adjustment.toLocaleString("ja-JP")}円
            </li>
          )}
        </NavigationList>
      )}
    </>
  );
}

function DetailError() {
  return (
    <Alert variant="destructive">
      <AlertDescription>
        給与見込み詳細を取得できませんでした。
      </AlertDescription>
    </Alert>
  );
}

export function PayrollEstimateDetailView({
  state,
  month,
  loading = false,
  hasError = false,
  navigateToMonth,
}: {
  state: AdminUserMonthlyPayrollEstimateDetailState | undefined;
  month: string;
  loading?: boolean;
  hasError?: boolean;
  navigateToMonth: (targetMonth: string) => void;
}) {
  if (loading) {
    return (
      <p className="text-sm text-zinc-600" role="status">
        給与見込み詳細を読み込み中
      </p>
    );
  }
  if (hasError) return <DetailError />;
  if (state?.status === "ready") {
    return (
      <PayrollEstimateDetailContent
        detail={state.data}
        month={month}
        navigateToMonth={navigateToMonth}
      />
    );
  }
  if (state) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}
