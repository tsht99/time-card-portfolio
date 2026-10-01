import type { WorkPeriod } from "@repo/contracts";
import { Alert, AlertDescription } from "@repo/ui/components/alert";
import { Button } from "@repo/ui/components/button";
import { Card } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { WorkPeriodIcon } from "@/app/_components/work-period-icon";
import { StaffAttendanceStatus } from "@/app/(staff)/_components/staff-attendance-status";

type StaffClockState = "not_working" | "working_day" | "working_night";

export type AttendanceActionPanelProps = {
  statusLabel: string;
  isError: boolean;
  clockState: StaffClockState | null;
  canStart: { day: boolean; night: boolean };
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
  return (
    <Card>
      <div
        className="flex h-8 min-w-0 items-center gap-2 whitespace-nowrap overflow-hidden"
        role="status"
      >
        {props.clockState && !props.isError ? (
          <StaffAttendanceStatus status={props.clockState} />
        ) : (
          <span
            className={`truncate text-lg font-semibold ${props.isError ? "text-red-700" : "text-zinc-950"}`}
          >
            {props.statusLabel}
          </span>
        )}
      </div>
      {props.clockState && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <label htmlFor="attendance-time" className="shrink-0 text-sm">
              打刻時刻
            </label>
            <Input
              id="attendance-time"
              className="min-w-0 flex-1"
              type="time"
              value={props.time}
              disabled={props.busy}
              onChange={(event) => props.onTimeChange(event.target.value)}
            />
          </div>
          <div className="mt-4 flex h-11 items-stretch gap-2">
            {props.clockState === "not_working" &&
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
            {(props.clockState === "working_day" ||
              props.clockState === "working_night") && (
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
