import type {
  StaffAttendanceItem,
  StaffCurrentAttendance,
} from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { mergeMonthlyAttendance } from "./monthly-attendance-view-model";

const item = (
  id: string,
  attendanceDate: string,
  workPeriod: "day" | "night" = "day",
  clockInAt = `${attendanceDate}T09:00:00.000Z`,
  eventVersion = 1,
): StaffAttendanceItem => ({
  attendanceId: id,
  eventVersion,
  attendanceDate,
  workPeriod,
  clockInAt,
  clockOutAt: null,
  workedMinutes: null,
});

const current = (
  attendances: StaffAttendanceItem[],
  referenceDate = "2026-08-01",
): StaffCurrentAttendance => ({ referenceDate, attendances });

describe("monthly attendance view model", () => {
  it("groups canonical history items by their attendanceDate", () => {
    const result = mergeMonthlyAttendance(
      [item("d", "2026-08-01"), item("n", "2026-08-02", "night")],
      null,
      "2026-08",
    );
    expect(result.map(({ date }) => date)).toEqual([
      "2026-08-02",
      "2026-08-01",
    ]);
    expect(result[0]?.attendance.night[0]?.attendanceId).toBe("n");
  });

  it("does not add an item from another month", () => {
    expect(
      mergeMonthlyAttendance([item("d", "2026-09-01")], null, "2026-08"),
    ).toEqual([]);
  });

  it("uses the larger eventVersion when current and history overlap", () => {
    const result = mergeMonthlyAttendance(
      [item("shared", "2026-08-01", "day", "2026-08-01T09:00:00.000Z", 1)],
      current([
        item("shared", "2026-08-02", "night", "2026-08-02T09:00:00.000Z", 2),
      ]),
      "2026-08",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.date).toBe("2026-08-02");
    expect(result[0]?.attendance.night[0]?.attendanceId).toBe("shared");
    expect(result[0]?.attendance.day).toEqual([]);
  });

  it("keeps all different attendanceIds in the same day and period", () => {
    const result = mergeMonthlyAttendance(
      [
        item("late", "2026-08-01", "day", "2026-08-01T12:00:00.000Z"),
        item("early", "2026-08-01", "day", "2026-08-01T09:00:00.000Z"),
      ],
      null,
      "2026-08",
    );
    expect(
      result[0]?.attendance.day.map(({ attendanceId }) => attendanceId),
    ).toEqual(["early", "late"]);
  });

  it("uses a deterministic current item for an equal-version tie", () => {
    const result = mergeMonthlyAttendance(
      [item("shared", "2026-08-01")],
      current([item("shared", "2026-08-02")]),
      "2026-08",
    );
    expect(result.map(({ date }) => date)).toEqual(["2026-08-02"]);
  });
});
