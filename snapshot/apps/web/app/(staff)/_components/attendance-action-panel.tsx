import type { WorkPeriod } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { WorkPeriodIcon } from "@/app/_components/work-period-icon";
import { StaffAttendanceStatus } from "@/app/(staff)/_components/staff-attendance-status";
import { formatTokyoCalendarDate } from "@/lib/tokyo-date-time";

type StaffWorkStatus = "not_working" | "working_day" | "working_night";

export type AttendanceActionPanelProps = {
  statusLabel: string;
  isError: boolean;
  workStatus: StaffWorkStatus | null;
  canStart: { day: boolean; night: boolean };
  date: string;
  time: string;
  busy: boolean;
  pendingOperation?: "clock_in" | "clock_out" | null;
  pendingWorkPeriod?: WorkPeriod | null;
  errorMessage: string | null;
  onRetry: (() => void) | null;
  onTimeChange: (value: string) => void;
  onClockIn: (period: WorkPeriod) => void;
  onClockOut: () => void;
};

export function AttendanceActionPanel(props: AttendanceActionPanelProps) {
  const formattedDate = formatTokyoCalendarDate(props.date);
  return (
    <Card>
      <div
        className="flex h-8 min-w-0 items-center gap-2 whitespace-nowrap overflow-hidden"
        role="status"
      >
        {props.workStatus && !props.isError ? (
          <StaffAttendanceStatus status={props.workStatus} />
        ) : (
          <span
            className={`truncate text-lg font-semibold ${props.isError ? "text-red-700" : "text-zinc-950"}`}
          >
            {props.statusLabel}
          </span>
        )}
      </div>
      {props.workStatus && (
        <>
          <div className="mt-4 flex min-w-0 items-center gap-2">
            <span className="shrink-0 whitespace-nowrap text-sm leading-5 font-medium tabular-nums text-zinc-700">
              {formattedDate}
            </span>
            <Input
              id="attendance-time"
              className="min-w-0 flex-1 basis-0 px-2"
              type="time"
              aria-label={`打刻時刻 ${formattedDate}`}
              value={props.time}
              disabled={props.busy}
              onChange={(event) => props.onTimeChange(event.target.value)}
            />
          </div>
          <div className="mt-4 flex h-11 items-stretch gap-2">
            {props.workStatus === "not_working" &&
              (["day", "night"] as const).map((period) => (
                <Button
                  key={period}
                  type="button"
                  className="min-w-0 flex-1 gap-1.5 px-2"
                  disabled={props.busy || !props.canStart[period]}
                  onClick={() => props.onClockIn(period)}
                >
                  <WorkPeriodIcon workPeriod={period} />
                  {props.pendingOperation === "clock_in" &&
                  props.pendingWorkPeriod === period
                    ? "出勤中…"
                    : `${period === "day" ? "昼" : "夜"}に出勤`}
                </Button>
              ))}
            {(props.workStatus === "working_day" ||
              props.workStatus === "working_night") && (
              <Button
                type="button"
                className="min-w-0 flex-1"
                disabled={props.busy}
                onClick={props.onClockOut}
              >
                {props.pendingOperation === "clock_out" ? "退勤中…" : "退勤"}
              </Button>
            )}
          </div>
        </>
      )}
      {props.errorMessage && (
        <Alert className="mt-4" variant="destructive">
          <AlertDescription>
            <span>{props.errorMessage}</span>
            {props.onRetry && (
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={props.onRetry}
              >
                再試行
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </Card>
  );
}
