import {
  type AttendanceAggregate,
  calculateWorkedMinutes,
} from "../domain/attendance.ts";
import type { StoredAttendanceEvent } from "./attendance-event-store.ts";
import type {
  AttendanceDetail,
  AttendanceEventHistoryItem,
} from "./attendance-types.ts";

export type AttendanceDetailUser = {
  userId: string;
  displayName: string | null;
};

function assertDetailRequiredFields(
  aggregate: AttendanceAggregate,
): asserts aggregate is AttendanceAggregate & {
  attendanceDate: string;
  userId: string;
  workPeriod: NonNullable<AttendanceAggregate["workPeriod"]>;
  clockInAt: Date;
} {
  if (
    aggregate.attendanceDate === null ||
    aggregate.userId === null ||
    aggregate.workPeriod === null ||
    aggregate.clockInAt === null
  ) {
    throw new Error(
      "Attendance aggregate cannot be detailed without required attendance fields.",
    );
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported attendance event: ${String(value)}`);
}

export function toAttendanceEventHistoryItem(
  event: StoredAttendanceEvent,
): AttendanceEventHistoryItem {
  switch (event.eventType) {
    case "AttendanceClockedIn":
      return {
        eventId: event.eventId,
        attendanceId: event.attendanceId,
        eventVersion: event.eventVersion,
        eventType: event.eventType,
        performedByUserId: event.performedByUserId,
        createdAt: event.createdAt.toISOString(),
        payload: {
          ...event.payload,
          clockInAt: event.payload.clockInAt.toISOString(),
        },
      };
    case "AttendanceClockedOut":
      return {
        eventId: event.eventId,
        attendanceId: event.attendanceId,
        eventVersion: event.eventVersion,
        eventType: event.eventType,
        performedByUserId: event.performedByUserId,
        createdAt: event.createdAt.toISOString(),
        payload: {
          clockOutAt: event.payload.clockOutAt.toISOString(),
        },
      };
    case "WorkPeriodCorrected":
      return {
        eventId: event.eventId,
        attendanceId: event.attendanceId,
        eventVersion: event.eventVersion,
        eventType: event.eventType,
        performedByUserId: event.performedByUserId,
        createdAt: event.createdAt.toISOString(),
        payload: event.payload,
      };
    case "ClockInTimeCorrected":
      return {
        eventId: event.eventId,
        attendanceId: event.attendanceId,
        eventVersion: event.eventVersion,
        eventType: event.eventType,
        performedByUserId: event.performedByUserId,
        createdAt: event.createdAt.toISOString(),
        payload: {
          clockInAt: event.payload.clockInAt.toISOString(),
        },
      };
    case "ClockOutTimeCorrected":
      return {
        eventId: event.eventId,
        attendanceId: event.attendanceId,
        eventVersion: event.eventVersion,
        eventType: event.eventType,
        performedByUserId: event.performedByUserId,
        createdAt: event.createdAt.toISOString(),
        payload: {
          clockOutAt: event.payload.clockOutAt.toISOString(),
        },
      };
    case "AttendanceCancelled":
      return {
        eventId: event.eventId,
        attendanceId: event.attendanceId,
        eventVersion: event.eventVersion,
        eventType: event.eventType,
        performedByUserId: event.performedByUserId,
        createdAt: event.createdAt.toISOString(),
        payload: event.payload,
      };
    default:
      return assertNever(event);
  }
}

export function buildAdminAttendanceDetail(
  aggregate: AttendanceAggregate,
  events: readonly StoredAttendanceEvent[],
  users: readonly AttendanceDetailUser[],
): AttendanceDetail {
  assertDetailRequiredFields(aggregate);
  const state = aggregate.state;
  const names = new Map(users.map((user) => [user.userId, user.displayName]));
  const clockOutAt = aggregate.isCancelled ? null : state.clockOutAt;

  return {
    attendanceId: aggregate.attendanceId,
    eventVersion: aggregate.version,
    attendanceDate: aggregate.attendanceDate,
    userId: aggregate.userId,
    displayName: names.get(aggregate.userId) ?? null,
    workPeriod: aggregate.workPeriod,
    clockInAt: aggregate.clockInAt.toISOString(),
    clockOutAt: clockOutAt?.toISOString() ?? null,
    workedMinutes:
      clockOutAt === null
        ? null
        : calculateWorkedMinutes(aggregate.clockInAt, clockOutAt),
    status: aggregate.isCancelled
      ? "cancelled"
      : clockOutAt === null
        ? "working"
        : "completed",
    history: events.map(toAttendanceEventHistoryItem),
  };
}
