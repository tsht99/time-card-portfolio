import { calculateWorkedMinutes } from "../domain/attendance.ts";
import type { AttendanceCurrentState } from "./attendance-current-state.ts";
import type { StaffAttendanceItem } from "./attendance-types.ts";

export function summarizeCurrentState(
  state: AttendanceCurrentState,
): StaffAttendanceItem {
  return {
    attendanceId: state.attendanceId,
    eventVersion: state.eventVersion,
    attendanceDate: state.attendanceDate,
    workPeriod: state.workPeriod,
    clockInAt: state.clockInAt.toISOString(),
    clockOutAt: state.clockOutAt?.toISOString() ?? null,
    workedMinutes: state.clockOutAt
      ? calculateWorkedMinutes(state.clockInAt, state.clockOutAt)
      : null,
  };
}
