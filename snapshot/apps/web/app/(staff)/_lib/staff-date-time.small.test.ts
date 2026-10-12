import { describe, expect, it } from "vitest";
import {
  formatTime,
  getCurrentStaffDateTime,
  toOccurredAt,
} from "./staff-date-time";

describe("staff date time utilities", () => {
  it("明示した日時を東京の日付と時刻で取得する", () => {
    expect(
      getCurrentStaffDateTime(new Date("2026-09-11T14:30:00.000Z")),
    ).toEqual({ date: "2026-09-11", time: "23:30" });
  });
  it("表示日付と時刻をJST offset付き日時へ変換する", () => {
    expect(toOccurredAt("2026-09-11", "23:30")).toBe(
      "2026-09-11T23:30:00+09:00",
    );
  });
  it("ISO日時を東京時刻で表示し、nullはプレースホルダーにする", () => {
    expect(formatTime("2026-09-11T14:30:00.000Z")).toBe("23:30");
    expect(formatTime(null)).toBe("--:--");
  });
});
