import type {
  AttendanceOperationalStatus,
  WorkPeriod,
} from "../../domain/attendance.ts";
import type { AttendanceCurrentState } from "../attendance-current-state.ts";
export type AttendanceCurrentStateQuery = {
  attendanceDateOrWorking?: string;
  startAttendanceDateInclusive?: string;
  endAttendanceDateInclusive?: string;
  userId?: string;
  workPeriod?: WorkPeriod;
  status?: AttendanceOperationalStatus;
  includeCancelled?: boolean;
  /** Include active and cancelled rows; legacy includeCancelled remains exact when omitted. */
  includeAllCancellationStates?: boolean;
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
