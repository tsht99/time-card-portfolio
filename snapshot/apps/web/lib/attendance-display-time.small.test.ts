import { describe, expect, it } from "vitest";
import { formatStaffClockOutTime } from "./attendance-display-time";

describe("attendance display time", () => {
  it("退勤時刻は勤務日からの日付差を24時間超で表示する", () => {
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
    expect(
      formatStaffClockOutTime("2026-09-23T18:59:00.000Z", "2026-09-20"),
    ).toBe("99:59");
    expect(
      formatStaffClockOutTime("2026-09-23T19:00:00.000Z", "2026-09-20"),
    ).toBe("100:00");
    expect(
      formatStaffClockOutTime("2026-09-30T18:59:00.000Z", "2026-09-27"),
    ).toBe("99:59");
    expect(
      formatStaffClockOutTime("2027-01-03T18:59:00.000Z", "2026-12-31"),
    ).toBe("99:59");
  });

  it("月末・年末・UTC/JSTの日付差を東京日付で判定する", () => {
    expect(
      formatStaffClockOutTime("2026-02-28T15:00:00.000Z", "2026-02-28"),
    ).toBe("24:00");
    expect(
      formatStaffClockOutTime("2026-12-31T15:00:00.000Z", "2026-12-31"),
    ).toBe("24:00");
    expect(
      formatStaffClockOutTime("2026-09-20T14:00:00.000Z", "2026-09-20"),
    ).toBe("23:00");
    expect(
      formatStaffClockOutTime("2026-09-20T15:00:00.000Z", "2026-09-20"),
    ).toBe("24:00");
  });
});
