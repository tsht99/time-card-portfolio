import type { StaffAttendanceItem } from "@repo/contracts";
import { describe, expect, it } from "vitest";
import { deriveAttendanceViewModel } from "./attendance-view-model";

const row = (
  p: "day" | "night",
  id = "attendance",
  clockOutAt: string | null = null,
): StaffAttendanceItem => ({
  attendanceId: id,
  eventVersion: 1,
  attendanceDate: "2026-08-27",
  workPeriod: p,
  clockInAt: "2026-08-27T09:00:00.000Z",
  clockOutAt,
  workedMinutes: clockOutAt ? 540 : null,
});

function check(
  v: ReturnType<typeof deriveAttendanceViewModel>,
  s: string,
  t: string | null,
  st: [boolean, boolean],
  e: [string[], string[]],
) {
  expect(v.clockState).toBe(s);
  expect(v.clockOutTarget?.attendanceId ?? null).toBe(t);
  expect(v.canStart).toEqual({ day: st[0], night: st[1] });
  expect(v.availableEventTypes).toEqual({ day: e[0], night: e[1] });
}

describe("attendance view model", () => {
  it("未勤務", () =>
    check(
      deriveAttendanceViewModel([]),
      "not_working",
      null,
      [true, true],
      [["clock_in"], ["clock_in"]],
    ));
  it("昼勤務中", () =>
    check(
      deriveAttendanceViewModel([row("day")]),
      "working_day",
      "attendance",
      [false, false],
      [["clock_out"], []],
    ));
  it("夜勤務中", () =>
    check(
      deriveAttendanceViewModel([row("night")]),
      "working_night",
      "attendance",
      [false, false],
      [[], ["clock_out"]],
    ));
  it("日跨ぎ勤務中", () =>
    check(
      deriveAttendanceViewModel([
        { ...row("day"), attendanceDate: "2026-08-26" },
      ]),
      "working_day",
      "attendance",
      [false, false],
      [["clock_out"], []],
    ));
  it("完了済みの昼勤怠があっても新しい通常出勤を開始できる", () =>
    check(
      deriveAttendanceViewModel([
        row("day", "day", "2026-08-27T18:00:00.000Z"),
      ]),
      "not_working",
      null,
      [true, true],
      [["clock_in"], ["clock_in"]],
    ));
  it("昼夜とも完了済みでも本日の勤務完了状態にはしない", () =>
    check(
      deriveAttendanceViewModel([
        row("day", "d", "2026-08-27T18:00:00.000Z"),
        row("night", "n", "2026-08-27T18:00:00.000Z"),
      ]),
      "not_working",
      null,
      [true, true],
      [["clock_in"], ["clock_in"]],
    ));
  it("勤務中レコードが複数の曖昧状態", () =>
    check(
      deriveAttendanceViewModel([row("day", "day"), row("night", "night")]),
      "ambiguous",
      null,
      [false, false],
      [[], []],
    ));
});
