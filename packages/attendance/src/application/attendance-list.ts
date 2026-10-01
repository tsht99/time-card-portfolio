import type { AttendanceListStatus } from "../domain/attendance.ts";
import {
  calculateWorkedMinutes,
  type WorkPeriod,
} from "../domain/attendance.ts";
import type { AttendanceCurrentState } from "./attendance-current-state.ts";
import { filterAttendanceList } from "./attendance-query.ts";
import type {
  AttendanceListItem,
  CancelledAttendanceListItem,
  StaffAttendanceItem,
} from "./attendance-types.ts";

export type AttendanceListUser = {
  userId: string;
  displayName: string | null;
};

export function buildAttendanceList(
  states: readonly AttendanceCurrentState[],
  users: readonly AttendanceListUser[],
  filters: {
    startAttendanceDateInclusive: string;
    endAttendanceDateInclusive: string;
    userId?: string;
    workPeriod?: WorkPeriod;
    status?: AttendanceListStatus;
  },
): AttendanceListItem[] {
  const names = new Map(users.map((user) => [user.userId, user.displayName]));
  const items = states
    .filter((state) => !state.isCancelled)
    .filter(
      (state) =>
        state.attendanceDate >= filters.startAttendanceDateInclusive &&
        state.attendanceDate <= filters.endAttendanceDateInclusive,
    )
    .filter((state) => !filters.userId || state.userId === filters.userId)
    .filter(
      (state) => !filters.workPeriod || state.workPeriod === filters.workPeriod,
    )
    .map((state) => {
      const status = state.clockOutAt === null ? "working" : "completed";
      return {
        attendanceId: state.attendanceId,
        eventVersion: state.eventVersion,
        attendanceDate: state.attendanceDate,
        userId: state.userId,
        displayName: names.get(state.userId) ?? null,
        workPeriod: state.workPeriod,
        clockInAt: state.clockInAt.toISOString(),
        clockOutAt: state.clockOutAt?.toISOString() ?? null,
        workedMinutes: state.clockOutAt
          ? calculateWorkedMinutes(state.clockInAt, state.clockOutAt)
          : null,
        status,
      } satisfies AttendanceListItem;
    });
  return filterAttendanceList(items, filters.status).sort((left, right) => {
    return (
      left.attendanceDate.localeCompare(right.attendanceDate) ||
      left.userId.localeCompare(right.userId) ||
      left.workPeriod.localeCompare(right.workPeriod)
    );
  });
}

function cancelledAttendanceToListItem(
  state: AttendanceCurrentState,
  names: ReadonlyMap<string, string | null>,
): CancelledAttendanceListItem {
  return {
    attendanceId: state.attendanceId,
    attendanceDate: state.attendanceDate,
    userId: state.userId,
    displayName: names.get(state.userId) ?? null,
    workPeriod: state.workPeriod,
    clockInAt: state.clockInAt.toISOString(),
  };
}

export function buildCancelledAttendanceList(
  states: readonly AttendanceCurrentState[],
  users: readonly AttendanceListUser[],
  filters: {
    startAttendanceDateInclusive: string;
    endAttendanceDateInclusive: string;
    userId?: string;
    workPeriod?: WorkPeriod;
  },
): CancelledAttendanceListItem[] {
  const names = new Map(users.map((user) => [user.userId, user.displayName]));
  return states
    .filter((state) => state.isCancelled)
    .map((state) => cancelledAttendanceToListItem(state, names))
    .filter(
      (item) =>
        item.attendanceDate >= filters.startAttendanceDateInclusive &&
        item.attendanceDate <= filters.endAttendanceDateInclusive,
    )
    .filter((item) => !filters.userId || item.userId === filters.userId)
    .filter(
      (item) => !filters.workPeriod || item.workPeriod === filters.workPeriod,
    )
    .sort((left, right) => {
      return (
        left.attendanceDate.localeCompare(right.attendanceDate) ||
        left.userId.localeCompare(right.userId) ||
        left.workPeriod.localeCompare(right.workPeriod) ||
        left.clockInAt.localeCompare(right.clockInAt) ||
        left.attendanceId.localeCompare(right.attendanceId)
      );
    });
}

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
