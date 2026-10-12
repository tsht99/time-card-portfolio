import assert from "node:assert/strict";
import test from "node:test";
import {
  attendanceListQuerySchema,
  createAdminAttendanceRequestSchema,
  createAttendanceEventRequestSchema,
} from "@repo/contracts";

test("attendance event contract validates each field and shape", () => {
  const attendanceId = "66666666-6666-4666-8666-666666666666";
  const valid = {
    workPeriod: "day",
    eventType: "clock_in",
    occurredAt: "2026-08-22T09:00:00+09:00",
  };
  assert.equal(
    createAttendanceEventRequestSchema.safeParse(valid).success,
    true,
  );
  assert.equal(
    createAttendanceEventRequestSchema.safeParse({
      workPeriod: "day",
      eventType: "clock_out",
      occurredAt: "2026-08-22T18:00:00+09:00",
      targetAttendanceId: attendanceId,
      targetEventVersion: 1,
    }).success,
    true,
  );
  assert.equal(
    createAttendanceEventRequestSchema.safeParse({
      workPeriod: "day",
      eventType: "clock_out",
    }).success,
    false,
  );

  for (const invalid of [
    { ...valid, workPeriod: "evening" },
    { ...valid, eventType: "pause" },
    { ...valid, occurredAt: "2026-08-22T25:00:00+09:00" },
    {
      workPeriod: "day",
      eventType: "clock_in",
      time: "09:00",
    },
    {
      workPeriod: "day",
      eventType: "clock_out",
      targetAttendanceId: attendanceId,
      targetEventVersion: 1,
      clockOutTimeUnknown: true,
      occurredAt: "2026-08-22T09:00:00+09:00",
    },
    { workPeriod: "day", eventType: "clock_in", clockOutTimeUnknown: true },
    { workPeriod: "day", eventType: "clock_out", clockOutTimeUnknown: false },
    {
      workPeriod: "day",
      eventType: "clock_out",
      occurredAt: "2026-08-22T09:00:00+09:00",
      targetAttendanceId: attendanceId,
    },
    {
      workPeriod: "day",
      eventType: "clock_out",
      occurredAt: "2026-08-22T09:00:00+09:00",
      targetEventVersion: 1,
    },
    {
      workPeriod: "day",
      eventType: "clock_out",
      occurredAt: "2026-08-22T09:00:00+09:00",
      targetAttendanceId: "not-a-uuid",
      targetEventVersion: 1,
    },
    {
      workPeriod: "day",
      eventType: "clock_out",
      clockOutTimeUnknown: true,
      extra: true,
    },
  ]) {
    assert.equal(
      createAttendanceEventRequestSchema.safeParse(invalid).success,
      false,
    );
  }
});

test("attendance list query rejects invalid values", () => {
  const valid = { from: "2026-08-01", to: "2026-08-01" };
  assert.equal(
    attendanceListQuerySchema.safeParse({
      ...valid,
      userId: "550e8400-e29b-41d4-a716-446655440000",
      workPeriod: "day",
      status: "completed",
    }).success,
    true,
  );

  for (const invalid of [
    { userId: "not-a-uuid" },
    { userId: "" },
    { workPeriod: "evening" },
    { workPeriod: "" },
    { status: "pending" },
    { status: "" },
    { from: "2026/08/01" },
    { from: "2026-02-30" },
    { from: "2026-08-02", to: "2026-08-01" },
  ]) {
    assert.equal(
      attendanceListQuerySchema.safeParse({ ...valid, ...invalid }).success,
      false,
    );
  }
});

test("admin attendance creation requires a UUID userId", () => {
  const valid = {
    userId: "550e8400-e29b-41d4-a716-446655440000",
    workPeriod: "day",
    clockInAt: "2026-08-22T09:00:00+09:00",
    clockOutAt: "2026-08-22T18:00:00+09:00",
  };
  assert.equal(
    createAdminAttendanceRequestSchema.safeParse(valid).success,
    true,
  );
  for (const userId of [
    "staff-1",
    "",
    "550e8400-e29b-41d4-a716-44665544000z",
  ]) {
    assert.equal(
      createAdminAttendanceRequestSchema.safeParse({ ...valid, userId })
        .success,
      false,
    );
  }
});
