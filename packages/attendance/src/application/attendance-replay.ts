import {
  AttendanceAggregate,
  type AttendanceDomainEvent,
} from "../domain/attendance.ts";
import {
  type AttendanceCurrentState,
  aggregateToCurrentState,
} from "./attendance-current-state.ts";
import type { AttendanceEventStore } from "./attendance-event-store.ts";

export type AttendanceReplayFailureHandler = (
  attendanceId: string,
  sourceError: unknown,
) => never;

export function replayAttendanceEventStreams(
  events: readonly AttendanceDomainEvent[],
  onReplayFailure?: AttendanceReplayFailureHandler,
): AttendanceAggregate[] {
  const grouped = new Map<string, AttendanceDomainEvent[]>();
  for (const event of events) {
    const stream = grouped.get(event.attendanceId) ?? [];
    stream.push(event);
    grouped.set(event.attendanceId, stream);
  }
  return [...grouped.values()].map((stream) => {
    try {
      return AttendanceAggregate.replay(stream);
    } catch (error) {
      if (onReplayFailure !== undefined)
        return onReplayFailure(stream[0].attendanceId, error);
      throw error;
    }
  });
}

export async function replayAttendanceAggregates(
  eventStore: AttendanceEventStore,
  userId?: string,
) {
  const events = userId
    ? await eventStore.readStreamsByUserId(userId)
    : // Without a userId, clockInAt/workPeriod are mutable event data, so the
      // event store cannot safely pre-filter these candidate streams.
      await eventStore.readAll();
  return replayAttendanceEventStreams(events);
}

export async function replayAttendanceCurrentStates(
  eventStore: AttendanceEventStore,
  userId?: string,
): Promise<AttendanceCurrentState[]> {
  const events = userId
    ? await eventStore.readStreamsByUserId(userId)
    : // Without a userId, clockInAt/workPeriod are mutable event data, so the
      // event store cannot safely pre-filter these candidate streams.
      await eventStore.readAll();
  return replayAttendanceCurrentStatesFromEvents(events);
}

export function replayAttendanceCurrentStatesFromEvents(
  events: readonly AttendanceDomainEvent[],
  onReplayFailure?: AttendanceReplayFailureHandler,
  options: { includeCancelled?: boolean } = {},
): AttendanceCurrentState[] {
  const aggregates = replayAttendanceEventStreams(events, onReplayFailure);
  return aggregates
    .filter((aggregate) => options.includeCancelled || !aggregate.isCancelled)
    .map(aggregateToCurrentState);
}
