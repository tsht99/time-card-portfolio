import { describe, expect, it } from "vitest";
import {
  formatTokyoCalendarDate,
  formatTokyoDateTime,
  formatTokyoTime,
  getMillisecondsUntilNextTokyoMidnight,
  getTokyoDate,
  getTokyoMonth,
  toTokyoDateTimeLocal,
} from "./tokyo-date-time";

describe("display date time utilities", () => {
  const utcValue = "2026-09-03T09:15:00.000Z";

  it("UTC日時を東京時刻のHH:mmで表示する", () => {
    expect(formatTokyoTime(utcValue)).toBe("18:15");
    expect(formatTokyoTime(new Date(utcValue))).toBe("18:15");
  });

  it("UTC日時を既存の日本語日時形式で表示する", () => {
    expect(formatTokyoDateTime(utcValue)).toBe("2026/09/03 18:15");
  });

  it("UTC日時から東京暦日と暦月を返し、境界で切り替える", () => {
    expect(getTokyoDate("2026-01-31T14:59:59.999Z")).toBe("2026-01-31");
    expect(getTokyoDate("2026-01-31T15:00:00.000Z")).toBe("2026-02-01");
    expect(getTokyoDate("2026-12-31T15:00:00.000Z")).toBe("2027-01-01");
    expect(getTokyoMonth("2026-01-31T14:59:59.999Z")).toBe("2026-01");
    expect(getTokyoMonth("2026-01-31T15:00:00.000Z")).toBe("2026-02");
    expect(getTokyoMonth("2026-12-31T15:00:00.000Z")).toBe("2027-01");
  });

  it("東京暦日を曜日付きの日本語形式で表示する", () => {
    expect(formatTokyoCalendarDate("2026-01-01")).toBe("2026年1月1日（木）");
    expect(formatTokyoCalendarDate("2026-01-31")).toBe("2026年1月31日（土）");
    expect(formatTokyoCalendarDate("2026-02-01")).toBe("2026年2月1日（日）");
    expect(formatTokyoCalendarDate("2027-01-01")).toBe("2027年1月1日（金）");
    expect(formatTokyoCalendarDate("0099-01-01")).toBe("99年1月1日（木）");
    expect(formatTokyoCalendarDate("0000-01-01")).toBe("0年1月1日（土）");
    expect(formatTokyoCalendarDate("0100-01-01")).toBe("100年1月1日（金）");
  });

  it("東京の日時入力値を既存の年月日時分形式で返す", () => {
    expect(toTokyoDateTimeLocal(utcValue)).toBe("2026-09-03T18:15");
  });

  it("次の東京0時までの時間を返す", () => {
    expect(
      getMillisecondsUntilNextTokyoMidnight(
        new Date("2026-09-11T14:30:00.000Z"),
      ),
    ).toBe(30 * 60 * 1000);
  });
});
