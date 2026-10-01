import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceEventVersionConflictError } from "../application/attendance-event-store.ts";
import type { AttendanceDomainEvent } from "../domain/attendance.ts";
import { validateAttendanceEventAppend } from "./attendance-event-store.ts";

const event = (
  eventVersion: number,
  attendanceId = "attendance-1",
): AttendanceDomainEvent => ({
  eventType: "AttendanceClockedIn",
  eventVersion,
  attendanceId,
  payload: {
    userId: "user-1",
    attendanceDate: "2026-08-22",
    workPeriod: "day",
    clockInAt: new Date("2026-08-22T00:00:00.000Z"),
  },
});

const options = (expectedVersion: number) => ({
  expectedVersion,
  performedByUserId: "user-1",
});

test("新規streamへv1をappendできる", () => {
  assert.doesNotThrow(() =>
    validateAttendanceEventAppend([event(1)], options(0), 0),
  );
});

test("空streamへv2をappendできない", () => {
  assert.throws(
    () => validateAttendanceEventAppend([event(2)], options(0), 0),
    AttendanceEventVersionConflictError,
  );
});

test("v1の次にv2をappendできる", () => {
  assert.doesNotThrow(() =>
    validateAttendanceEventAppend([event(2)], options(1), 1),
  );
});

test("v1の次にv3をappendできない", () => {
  assert.throws(
    () => validateAttendanceEventAppend([event(3)], options(1), 1),
    AttendanceEventVersionConflictError,
  );
});

test("expectedVersionが実DB状態と異なれば拒否する", () => {
  assert.throws(
    () => validateAttendanceEventAppend([event(2)], options(0), 1),
    AttendanceEventVersionConflictError,
  );
});

test("batch内version gapを拒否する", () => {
  assert.throws(
    () => validateAttendanceEventAppend([event(1), event(3)], options(0), 0),
    AttendanceEventVersionConflictError,
  );
});

test("batch内の異なるattendanceIdを拒否する", () => {
  assert.throws(
    () =>
      validateAttendanceEventAppend(
        [event(1), event(2, "attendance-2")],
        options(0),
        0,
      ),
    AttendanceEventVersionConflictError,
  );
});
