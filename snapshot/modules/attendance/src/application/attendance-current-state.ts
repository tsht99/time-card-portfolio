import type { AttendanceAggregate, WorkPeriod } from "../domain/attendance.ts";

export type AttendanceCurrentState = {
  attendanceId: string;
  userId: string;
  attendanceDate: string;
  workPeriod: WorkPeriod;
  clockInAt: Date;
  clockOutAt: Date | null;
  eventVersion: number;
  isCancelled: boolean;
};
export function aggregateToCurrentState(
  aggregate: AttendanceAggregate,
): AttendanceCurrentState {
  const state = aggregate.state;
  if (
    state.userId === null ||
    state.workPeriod === null ||
    state.attendanceDate === null ||
    state.clockInAt === null
  ) {
    throw new Error(
      "Attendance aggregate cannot be projected without required current-state fields.",
    );
  }
  return {
    attendanceId: state.attendanceId,
    userId: state.userId,
    attendanceDate: state.attendanceDate,
    workPeriod: state.workPeriod,
    clockInAt: state.clockInAt,
    clockOutAt: state.clockOutAt,
    eventVersion: aggregate.version,
    isCancelled: aggregate.isCancelled,
  };
}
