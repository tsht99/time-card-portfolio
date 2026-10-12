import type { AttendanceCurrentState } from "./attendance-current-state.ts";
import { replayAttendanceCurrentStates } from "./attendance-replay.ts";
import type {
  AttendanceCurrentStateQuery,
  AttendanceCurrentStateReadModel,
} from "./ports/attendance-current-state-read-model.ts";
import type { AttendanceEventStore } from "./ports/attendance-event-store.ts";

function matchesCurrentStateQuery(
  state: AttendanceCurrentState,
  query: AttendanceCurrentStateQuery,
): boolean {
  if (
    query.attendanceDateOrWorking !== undefined &&
    state.attendanceDate !== query.attendanceDateOrWorking &&
    state.clockOutAt !== null
  ) {
    return false;
  }
  if (
    query.startAttendanceDateInclusive !== undefined &&
    state.attendanceDate < query.startAttendanceDateInclusive
  ) {
    return false;
  }
  if (
    query.endAttendanceDateInclusive !== undefined &&
    state.attendanceDate > query.endAttendanceDateInclusive
  ) {
    return false;
  }
  if (query.userId !== undefined && state.userId !== query.userId) return false;
  if (query.workPeriod !== undefined && state.workPeriod !== query.workPeriod)
    return false;
  if (query.status === "working" && state.clockOutAt !== null) return false;
  if (query.status === "completed" && state.clockOutAt === null) return false;
  if (
    !query.includeAllCancellationStates &&
    (query.includeCancelled === true) !== state.isCancelled
  ) {
    return false;
  }
  return true;
}

/** Internal read port for Payroll projections; keep this out of Delivery APIs. */
export function createAttendancePayrollProjectionReader(dependencies: {
  eventStore: AttendanceEventStore;
  currentStateReadModel: AttendanceCurrentStateReadModel;
}) {
  return {
    async getPayrollProjectionStates(
      query: AttendanceCurrentStateQuery,
      fallbackUserId?: string,
    ) {
      const result = await dependencies.currentStateReadModel.query(query);
      if (result.kind === "ready") return result.states;
      const states = await replayAttendanceCurrentStates(
        dependencies.eventStore,
        fallbackUserId ?? query.userId,
        query.includeCancelled === true ||
          query.includeAllCancellationStates === true,
      );
      return states.filter((state) => matchesCurrentStateQuery(state, query));
    },
  };
}
