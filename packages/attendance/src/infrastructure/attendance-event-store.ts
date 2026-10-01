import { AttendanceEventVersionConflictError } from "../application/attendance-event-store.ts";
import type { AttendanceDomainEvent } from "../domain/attendance.ts";

export type { StoredAttendanceEvent } from "../application/attendance-event-store.ts";

export function validateAttendanceEventAppend(
  events: readonly AttendanceDomainEvent[],
  options: { expectedVersion: number; performedByUserId: string },
  actualVersion: number,
): void {
  if (events.length === 0) return;
  const attendanceId = events[0].attendanceId;
  if (events.some((event) => event.attendanceId !== attendanceId)) {
    throw new AttendanceEventVersionConflictError(
      "All events in one append must belong to the same attendance stream.",
    );
  }
  if (actualVersion !== options.expectedVersion) {
    throw new AttendanceEventVersionConflictError(
      `Expected attendance stream version ${options.expectedVersion}, but found ${actualVersion}.`,
      options.expectedVersion,
      actualVersion,
    );
  }
  for (const [index, event] of events.entries()) {
    const expectedEventVersion = options.expectedVersion + index + 1;
    if (event.eventVersion !== expectedEventVersion) {
      throw new AttendanceEventVersionConflictError(
        `Expected event version ${expectedEventVersion}, but found ${event.eventVersion}.`,
        expectedEventVersion,
        event.eventVersion,
      );
    }
  }
}
