import type { AttendanceDomainEvent } from "../domain/attendance.ts";

export type StoredAttendanceEvent = AttendanceDomainEvent & {
  eventId: string;
  performedByUserId: string;
  createdAt: Date;
};
export type AttendanceEventAppendOptions = {
  expectedVersion: number;
  performedByUserId: string;
};
export type AttendanceLock =
  | { type: "user"; userId: string }
  | { type: "stream"; attendanceId: string };
export class AttendanceEventVersionConflictError extends Error {
  constructor(
    message: string,
    readonly expectedVersion?: number,
    readonly actualVersion?: number,
  ) {
    super(message);
    this.name = "AttendanceEventVersionConflictError";
  }
}
export interface AttendanceEventStore {
  runExclusive<T>(
    lock: AttendanceLock,
    operation: (store: AttendanceEventStore) => Promise<T>,
  ): Promise<T>;
  readAll(): Promise<readonly StoredAttendanceEvent[]>;
  readStream(attendanceId: string): Promise<readonly StoredAttendanceEvent[]>;
  readStreamsByUserId(
    userId: string,
  ): Promise<readonly StoredAttendanceEvent[]>;
  append(
    events: readonly AttendanceDomainEvent[],
    options: AttendanceEventAppendOptions,
  ): Promise<void>;
}
