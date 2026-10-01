import type { AdminAttendanceDetail } from "@repo/contracts";
import Link from "next/link";
import { WorkPeriodLabel } from "@/app/_components/work-period-label";
import { formatTokyoDateTime } from "../../../lib/display-date-time";

function formatDate(value: string) {
  return value.replaceAll("-", "/");
}

function formatWorkedMinutes(minutes: number | null) {
  return minutes === null
    ? "未算出"
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function formatStatus(status: AdminAttendanceDetail["status"]) {
  return status === "working"
    ? "勤務中"
    : status === "completed"
      ? "退勤済み"
      : "取消済み";
}

function formatHourlyWage(detail: AdminAttendanceDetail) {
  if (detail.payroll.status === "excluded") return "給与集計対象外";
  if (detail.payroll.status === "missingHourlyWage") return "時給未設定";
  return detail.payroll.hourlyWage === null
    ? "未算出"
    : `${detail.payroll.hourlyWage.toLocaleString("ja-JP")}円/時`;
}

function formatEstimatedPay(detail: AdminAttendanceDetail) {
  if (detail.payroll.status === "excluded") return "給与集計対象外";
  if (detail.payroll.status === "missingHourlyWage") return "時給未設定";
  if (detail.payroll.status === "clockOutMissing") return "退勤未記録";
  if (detail.payroll.status === "incomplete") return "勤怠不完全";
  return detail.payroll.estimatedPayYen === null
    ? "勤怠不完全"
    : `${detail.payroll.estimatedPayYen.toLocaleString("ja-JP")}円`;
}

export function AttendanceCurrentSummary({
  detail,
  heading,
  headingId,
  hourlyWageSettingsHref,
}: {
  detail: AdminAttendanceDetail;
  heading: string;
  headingId: string;
  hourlyWageSettingsHref?: string;
}) {
  return (
    <section className="mt-6 min-w-0" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-base font-semibold">
        {heading}
      </h2>
      <dl className="mt-3 min-w-0 rounded-md border border-zinc-200 bg-white p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 pb-3">
          <div>
            <dt className="sr-only">勤務日</dt>
            <dd>{formatDate(detail.attendanceDate)}</dd>
          </div>
          <div>
            <dt className="sr-only">勤務区分</dt>
            <dd>
              <WorkPeriodLabel workPeriod={detail.workPeriod} />
            </dd>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 pt-3">
          <div className="min-w-0">
            <dt className="text-sm text-zinc-600">勤務状態</dt>
            <dd className="break-words">{formatStatus(detail.status)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-zinc-600">出勤</dt>
            <dd className="break-words">
              {formatTokyoDateTime(detail.clockInAt)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-zinc-600">退勤</dt>
            <dd className="break-words">
              {detail.clockOutAt
                ? formatTokyoDateTime(detail.clockOutAt)
                : "未記録"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-zinc-600">勤務時間</dt>
            <dd className="break-words">
              {formatWorkedMinutes(detail.workedMinutes)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-zinc-600">適用時給</dt>
            <dd className="break-words">
              {formatHourlyWage(detail)}
              {hourlyWageSettingsHref && (
                <Link
                  href={hourlyWageSettingsHref}
                  className="ml-2 text-sm text-blue-700 underline underline-offset-2"
                >
                  時給設定を確認
                </Link>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-zinc-600">給与見込み</dt>
            <dd className="break-words">{formatEstimatedPay(detail)}</dd>
          </div>
        </div>
      </dl>
    </section>
  );
}
