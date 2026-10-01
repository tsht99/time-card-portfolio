import type { AttendanceListStatus, WorkPeriod } from "../domain/attendance.ts";
import type { AttendanceCurrentState } from "./attendance-current-state.ts";
export type AttendanceCurrentStateQuery = {
  startAttendanceDateInclusive?: string;
  endAttendanceDateInclusive?: string;
  userId?: string;
  workPeriod?: WorkPeriod;
  status?: AttendanceListStatus;
  includeCancelled?: boolean;
};
export type AttendanceCurrentStateQueryResult =
  | { kind: "not-ready" }
  | { kind: "ready"; states: readonly AttendanceCurrentState[] };
export interface AttendanceCurrentStateReadModel {
  upsert(state: AttendanceCurrentState): Promise<void>;
  query(
    query: AttendanceCurrentStateQuery,
  ): Promise<AttendanceCurrentStateQueryResult>;
}
