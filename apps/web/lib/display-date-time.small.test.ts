import { describe, expect, it } from "vitest";
import { formatTokyoDateTime, formatTokyoTime } from "./display-date-time";

describe("display date time utilities", () => {
  const utcValue = "2026-09-03T09:15:00.000Z";

  it("UTC日時を東京時刻のHH:mmで表示する", () => {
    expect(formatTokyoTime(utcValue)).toBe("18:15");
    expect(formatTokyoTime(new Date(utcValue))).toBe("18:15");
  });

  it("UTC日時を既存の日本語日時形式で表示する", () => {
    expect(formatTokyoDateTime(utcValue)).toBe("2026/09/03 18:15");
  });
});
