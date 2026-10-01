import assert from "node:assert/strict";
import test from "node:test";

import type { AttendanceDomainEvent } from "../domain/attendance.ts";
import {
  AttendanceEventStoreCorruptionError,
  deserializeAttendanceEvent,
} from "./attendance-event-deserializer.ts";

const row = (eventType: string, payload: Record<string, unknown>) =>
  ({
    eventId: "event-1",
    performedByUserId: "user-1",
    eventType,
    eventVersion: 1,
    attendanceId: "attendance-1",
    createdAt: new Date("2026-08-22T00:00:00.000Z"),
    payload,
  }) as Parameters<typeof deserializeAttendanceEvent>[0];

type EventType = AttendanceDomainEvent["eventType"];
type EventFixture<K extends EventType> = {
  persistedPayload: Record<string, unknown>;
  expectedPayload: Extract<AttendanceDomainEvent, { eventType: K }>["payload"];
};

function isCorruptionError(error: unknown, fragment?: string): true {
  assert.ok(error instanceof Error);
  assert.equal(error.name, "AttendanceEventStoreCorruptionError");
  assert.match(error.message, /^Attendance event store corruption: /);
  if (fragment !== undefined) assert.match(error.message, new RegExp(fragment));
  return true;
}

const validPayloads = {
  AttendanceClockedIn: {
    persistedPayload: {
      userId: "user-1",
      workPeriod: "day",
      attendanceDate: "2026-08-22",
      clockInAt: "2026-08-22T18:00:00+09:00",
    },
    expectedPayload: {
      userId: "user-1",
      attendanceDate: "2026-08-22",
      workPeriod: "day",
      clockInAt: new Date("2026-08-22T09:00:00.000Z"),
    },
  },
  AttendanceClockedOut: {
    persistedPayload: { clockOutAt: "2026-08-23T03:00:00+09:00" },
    expectedPayload: { clockOutAt: new Date("2026-08-22T18:00:00.000Z") },
  },
  WorkPeriodCorrected: {
    persistedPayload: { workPeriod: "night" },
    expectedPayload: { workPeriod: "night" },
  },
  ClockInTimeCorrected: {
    persistedPayload: { clockInAt: "2026-08-22T05:00:00-04:00" },
    expectedPayload: { clockInAt: new Date("2026-08-22T09:00:00.000Z") },
  },
  ClockOutTimeCorrected: {
    persistedPayload: { clockOutAt: "2026-08-22T19:00:00.000Z" },
    expectedPayload: { clockOutAt: new Date("2026-08-22T19:00:00.000Z") },
  },
  AttendanceCancelled: {
    persistedPayload: {},
    expectedPayload: {},
  },
} satisfies { [K in EventType]: EventFixture<K> };

test("各Domain EventをDB JSONから復元できる", () => {
  for (const eventType of Object.keys(validPayloads) as EventType[]) {
    const { persistedPayload, expectedPayload } = validPayloads[eventType];
    const event = deserializeAttendanceEvent(row(eventType, persistedPayload));
    assert.equal(event.eventType, eventType);
    assert.equal(event.eventVersion, 1);
    assert.deepEqual(event.payload, expectedPayload);
  }
});

test("unknown eventTypeをEvent Store corruptionとして拒否する", () => {
  assert.throws(
    () => deserializeAttendanceEvent(row("UnknownEvent", {})),
    (error) => isCorruptionError(error, "Unknown eventType"),
  );
});

test("必須payload fieldの欠落を拒否し暗黙変換しない", () => {
  assert.throws(
    () =>
      deserializeAttendanceEvent(
        row("AttendanceClockedIn", {
          workPeriod: "day",
          clockInAt: "2026-08-22T09:00:00.000Z",
        }),
      ),
    (error) => isCorruptionError(error, "missing userId"),
  );
  assert.throws(
    () =>
      deserializeAttendanceEvent(
        row("AttendanceClockedOut", { clockOutAt: undefined }),
      ),
    (error) => isCorruptionError(error, "clockOutAt must be an ISO timestamp"),
  );
});

test("不正なworkPeriod、timestamp、attendanceDateを拒否する", () => {
  assert.throws(
    () =>
      deserializeAttendanceEvent(
        row("WorkPeriodCorrected", { workPeriod: "evening" }),
      ),
    (error) => isCorruptionError(error, "workPeriod must be day or night"),
  );
  assert.throws(
    () =>
      deserializeAttendanceEvent(
        row("ClockInTimeCorrected", { clockInAt: "not-a-date" }),
      ),
    (error) => isCorruptionError(error, "clockInAt must be an ISO timestamp"),
  );
  assert.throws(
    () =>
      deserializeAttendanceEvent(
        row("AttendanceClockedIn", {
          userId: "user-1",
          attendanceDate: "2026-02-30",
          workPeriod: "day",
          clockInAt: "2026-08-22T09:00:00.000Z",
        }),
      ),
    (error) => isCorruptionError(error, "attendanceDate must be a valid"),
  );
});

test("取消eventのpayloadがobjectでない場合はcorruptionとして拒否する", () => {
  assert.throws(
    () =>
      deserializeAttendanceEvent(
        row("AttendanceCancelled", null as unknown as Record<string, unknown>),
      ),
    (error) => isCorruptionError(error, "payload must be an object"),
  );
  assert.throws(
    () =>
      deserializeAttendanceEvent(
        row("AttendanceCancelled", [] as unknown as Record<string, unknown>),
      ),
    (error) => isCorruptionError(error, "payload must be an object"),
  );
});

test("corruption errorはUUID形式のattendanceIdだけを保持する", () => {
  const attendanceId = "66666666-6666-4666-8666-666666666666";
  assert.throws(
    () =>
      deserializeAttendanceEvent({
        ...row("AttendanceClockedOut", { clockOutAt: "not-a-date" }),
        attendanceId,
      }),
    (error) => {
      assert.ok(error instanceof AttendanceEventStoreCorruptionError);
      assert.equal(error.attendanceId, attendanceId);
      assert.match(error.stack ?? "", /requireTimestamp/);
      return true;
    },
  );
});
