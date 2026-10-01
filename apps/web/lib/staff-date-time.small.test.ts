import { describe, expect, it } from "vitest";
import {
  formatStaffClockOutTime,
  formatTime,
  getCurrentTime,
  getMillisecondsUntilNextTokyoMidnight,
} from "./staff-date-time";

describe("staff date time utilities", () => {
  it("明示した日時を東京時刻のHH:mmで表示する", () => {
    expect(getCurrentTime(new Date("2026-09-11T14:30:00.000Z"))).toBe("23:30");
  });

  it("ISO日時を東京時刻で表示し、nullはプレースホルダーにする", () => {
    expect(formatTime("2026-09-11T14:30:00.000Z")).toBe("23:30");
    expect(formatTime(null)).toBe("--:--");
  });

  it("スタッフの退勤時刻は勤務日の翌日だけ24時超で表示する", () => {
    expect(
      formatStaffClockOutTime("2026-09-20T14:59:00.000Z", "2026-09-20"),
    ).toBe("23:59");
    expect(
      formatStaffClockOutTime("2026-09-20T15:00:00.000Z", "2026-09-20"),
    ).toBe("24:00");
    expect(
      formatStaffClockOutTime("2026-09-20T16:00:00.000Z", "2026-09-20"),
    ).toBe("25:00");
    expect(
      formatStaffClockOutTime("2026-09-20T21:00:00.000Z", "2026-09-20"),
    ).toBe("30:00");
  });

  it("月末と年末の日付跨ぎをJSTの日付で判定する", () => {
    expect(
      formatStaffClockOutTime("2026-02-28T15:00:00.000Z", "2026-02-28"),
    ).toBe("24:00");
    expect(
      formatStaffClockOutTime("2026-12-31T15:00:00.000Z", "2026-12-31"),
    ).toBe("24:00");
  });

  it("UTCとJSTの日付が異なる場合も退勤のJST日付で判定する", () => {
    expect(
      formatStaffClockOutTime("2026-09-20T14:00:00.000Z", "2026-09-20"),
    ).toBe("23:00");
    expect(
      formatStaffClockOutTime("2026-09-20T15:00:00.000Z", "2026-09-20"),
    ).toBe("24:00");
  });

  it("東京23:30から次の東京0時までを計算する", () => {
    expect(
      getMillisecondsUntilNextTokyoMidnight(
        new Date("2026-09-11T14:30:00.000Z"),
      ),
    ).toBe(30 * 60 * 1000);
  });
});
