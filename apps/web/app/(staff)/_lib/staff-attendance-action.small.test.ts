import { describe, expect, test } from "vitest";
import {
  AttendanceActionError,
  resolveStaffAttendanceErrorMessage,
} from "./staff-attendance-action.ts";

const clockInOverlapMessage =
  "既存の勤怠と勤務時間が重複しています。出勤時刻を確認してください。";
const clockOutOverlapMessage =
  "既存の勤怠と勤務時間が重複しているため、退勤を記録できません。管理者に勤怠の確認を依頼してください。管理者による時刻の訂正、または誤って登録された勤怠の取消が必要な場合があります。";

describe("resolveStaffAttendanceErrorMessage", () => {
  test("clock-in overlap uses the clock-in guidance", () => {
    const error = new AttendanceActionError(
      "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
      "ATTENDANCE_TIME_OVERLAP",
    );

    expect(resolveStaffAttendanceErrorMessage(error, "clock_in")).toBe(
      clockInOverlapMessage,
    );
  });

  test("clock-out overlap uses the recovery guidance", () => {
    const error = new AttendanceActionError(
      "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
      "ATTENDANCE_TIME_OVERLAP",
    );

    expect(resolveStaffAttendanceErrorMessage(error, "clock_out")).toBe(
      clockOutOverlapMessage,
    );
  });

  test("clock-in and clock-out overlap guidance differ", () => {
    const error = new AttendanceActionError(
      "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
      "ATTENDANCE_TIME_OVERLAP",
    );

    expect(resolveStaffAttendanceErrorMessage(error, "clock_in")).not.toBe(
      resolveStaffAttendanceErrorMessage(error, "clock_out"),
    );
  });

  test("overlap without an event type preserves the existing message", () => {
    const error = new AttendanceActionError(
      "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
      "ATTENDANCE_TIME_OVERLAP",
    );

    expect(resolveStaffAttendanceErrorMessage(error, undefined)).toBe(
      error.message,
    );
  });

  test.each(["clock_in", "clock_out"] as const)(
    "stale errors preserve the existing message for %s",
    (eventType) => {
      const error = new AttendanceActionError(
        "勤務状態が更新されています。最新の状態を確認してください。",
        "ATTENDANCE_CLOCK_STALE",
      );

      expect(resolveStaffAttendanceErrorMessage(error, eventType)).toBe(
        error.message,
      );
    },
  );

  test("ordinary errors preserve the existing message", () => {
    const error = new Error("通常のエラー");

    expect(resolveStaffAttendanceErrorMessage(error, "clock_out")).toBe(
      error.message,
    );
  });

  test("null returns null", () => {
    expect(resolveStaffAttendanceErrorMessage(null, "clock_in")).toBeNull();
  });
});
