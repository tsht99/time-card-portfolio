import {
  attendanceListQuerySchema,
  createAttendanceEventRequestSchema,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";

describe("attendance request contracts", () => {
  const attendanceId = "66666666-6666-4666-8666-666666666666";
  it("validates each clock event field and shape", () => {
    const valid = {
      workPeriod: "day",
      eventType: "clock_in",
      time: "09:00",
    };
    expect(createAttendanceEventRequestSchema.safeParse(valid).success).toBe(
      true,
    );
    expect(
      createAttendanceEventRequestSchema.safeParse({
        workPeriod: "day",
        eventType: "clock_out",
        time: "18:00",
        targetAttendanceId: attendanceId,
        targetEventVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      createAttendanceEventRequestSchema.safeParse({
        workPeriod: "day",
        eventType: "clock_out",
        time: "18:00",
      }).success,
    ).toBe(true);

    for (const invalid of [
      { ...valid, workPeriod: "evening" },
      { ...valid, eventType: "pause" },
      { ...valid, time: "25:00" },
      {
        workPeriod: "day",
        eventType: "clock_in",
        occurredAt: "2026-08-22T09:00:00+09:00",
      },
      {
        workPeriod: "day",
        eventType: "clock_out",
        targetAttendanceId: attendanceId,
        targetEventVersion: 1,
        clockOutTimeUnknown: true,
        time: "09:00",
      },
      { workPeriod: "day", eventType: "clock_in", clockOutTimeUnknown: true },
      { workPeriod: "day", eventType: "clock_out", clockOutTimeUnknown: false },
      {
        workPeriod: "day",
        eventType: "clock_out",
        time: "09:00",
        targetAttendanceId: attendanceId,
      },
      {
        workPeriod: "day",
        eventType: "clock_out",
        time: "09:00",
        targetEventVersion: 1,
      },
      {
        workPeriod: "day",
        eventType: "clock_out",
        time: "09:00",
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
      expect(
        createAttendanceEventRequestSchema.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it("rejects invalid attendance list query values", () => {
    const valid = { from: "2026-08-01", to: "2026-08-01" };
    expect(
      attendanceListQuerySchema.safeParse({
        ...valid,
        userId: "550e8400-e29b-41d4-a716-446655440000",
        workPeriod: "day",
        status: "completed",
      }).success,
    ).toBe(true);

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
      expect(
        attendanceListQuerySchema.safeParse({ ...valid, ...invalid }).success,
      ).toBe(false);
    }
  });
});
