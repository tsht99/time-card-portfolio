import { describe, expect, it } from "vitest";
import {
  formatMonth,
  getCurrentMonth,
  isValidMonth,
  shiftMonth,
} from "./month";

describe("month utilities", () => {
  it("月の境界を跨いで移動し、年月の上下限を守る", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
    expect(shiftMonth("0001-01", -1)).toBeNull();
    expect(shiftMonth("9999-11", 1)).toBeNull();
  });

  it("不正な年月を拒否する", () => {
    for (const month of [
      "0000-01",
      "10000-01",
      "9999-12",
      "2026-00",
      "2026-13",
      "2026-1",
      "bad",
    ]) {
      expect(isValidMonth(month)).toBe(false);
      expect(shiftMonth(month, 1)).toBeNull();
    }
  });

  it("受理する年月の最小・最大値を守る", () => {
    expect(isValidMonth("0001-01")).toBe(true);
    expect(isValidMonth("0099-12")).toBe(true);
    expect(isValidMonth("2026-12")).toBe(true);
    expect(isValidMonth("9999-11")).toBe(true);
    expect(shiftMonth("9999-10", 1)).toBe("9999-11");
  });

  it("UTCとJSTの月境界で東京の現在月を返す", () => {
    expect(getCurrentMonth(new Date("2026-01-31T15:00:00.000Z"))).toBe(
      "2026-02",
    );
  });

  it("年月を日本語表示にする", () => {
    expect(formatMonth("2026-09")).toBe("2026年9月");
  });
});
