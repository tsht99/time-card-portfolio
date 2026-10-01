import type { StaffAttendanceItem, WorkPeriod } from "@repo/contracts";
import { AttendanceActionPanel } from "./attendance-action-panel.tsx";
import { StaffScreenFrame } from "./staff-screen-frame.tsx";
import { StaffTodayAttendancePanel } from "./staff-today-attendance-panel.tsx";

export function StaffClockView({
  statusLabel,
  isError,
  clockState,
  canStart,
  time,
  busy,
  pendingOperation = null,
  pendingWorkPeriod = null,
  errorMessage,
  onRetry,
  onTimeChange,
  onClockIn,
  onClockOut,
  todayAttendances,
}: {
  statusLabel: string;
  isError: boolean;
  clockState: "not_working" | "working_day" | "working_night" | null;
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
  todayAttendances: readonly StaffAttendanceItem[] | null;
}) {
  return (
    <main className="flex min-h-dvh flex-col px-0 py-0 text-zinc-950">
      <h1 className="sr-only">勤怠</h1>
      <StaffScreenFrame active="clock">
        <AttendanceActionPanel
          statusLabel={statusLabel}
          isError={isError}
          clockState={clockState}
          canStart={canStart}
          time={time}
          busy={busy}
          pendingOperation={pendingOperation}
          pendingWorkPeriod={pendingWorkPeriod}
          errorMessage={errorMessage}
          onRetry={onRetry}
          onTimeChange={onTimeChange}
          onClockIn={onClockIn}
          onClockOut={onClockOut}
        />
        <StaffTodayAttendancePanel attendances={todayAttendances} />
      </StaffScreenFrame>
    </main>
  );
}
