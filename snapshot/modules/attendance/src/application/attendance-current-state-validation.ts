import type { AttendanceAggregate } from "../domain/attendance.ts";
import {
  findAttendanceClockInTimeOverlap,
  findAttendanceTimeOverlap,
} from "../domain/attendance-overlap.ts";
import { replayAttendanceEventStreams } from "./attendance-replay.ts";
import type { AttendanceEventStore } from "./ports/attendance-event-store.ts";

/** Checks user-wide invariants through the ready projection, with an event replay fallback. */
export async function validateAttendanceAgainstUserHistory(
  store: AttendanceEventStore,
  candidate: AttendanceAggregate,
  options: { excludeAttendanceId?: string } = {},
) {
  const state = candidate.state;
  const clockInAt = candidate.clockInAt;
  const clockOutAt = candidate.clockOutAt;
  if (state.userId === null || clockInAt === null) {
    return {
      hasWorkingAttendance: false,
      hasClockInTimeConflict: false,
      hasOverlap: false,
    };
  }
  const conflicts = await store.findCurrentStateValidationConflicts({
    userId: state.userId,
    clockInAt,
    candidateInterval: {
      start: clockInAt,
      end: clockOutAt ?? clockInAt,
    },
    excludeAttendanceId: options.excludeAttendanceId,
  });
  if (conflicts.kind === "ready") return conflicts;

  const events = await store.readStreamsByUserId(state.userId);
  const aggregates = replayAttendanceEventStreams(
    events.filter(
      (event) => event.attendanceId !== options.excludeAttendanceId,
    ),
  );
  const states = aggregates.map((aggregate) => aggregate.state);
  return {
    hasWorkingAttendance: states.some(
      (existing) =>
        !existing.isCancelled &&
        existing.userId === state.userId &&
        existing.clockOutAt === null,
    ),
    hasClockInTimeConflict:
      findAttendanceClockInTimeOverlap(state.userId, clockInAt, states) !==
      null,
    hasOverlap: findAttendanceTimeOverlap(state, states) !== null,
  };
}
