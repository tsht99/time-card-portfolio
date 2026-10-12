import { describe, expect, it } from "vitest";
import { getUserGuideUrl } from "./user-guide";

describe("user guide links", () => {
  it.each([
    ["/clock", "/staff"],
    ["/history", "/staff/history"],
    ["/anything", "/staff"],
    ["/admin/attendance", "/admin/attendance"],
    ["/admin/attendance/new", "/admin/create-attendance"],
    ["/admin/attendance/abc", "/admin/attendance"],
    ["/admin/attendance/abc/edit", "/admin/correct-or-cancel-attendance"],
    ["/admin/payroll-estimates", "/admin/payroll-estimate"],
    ["/admin/users/abc/payroll-estimates", "/admin/payroll-estimate"],
    ["/admin/users", "/admin/users"],
    ["/admin/users/abc", "/admin/users"],
    ["/admin/users/abc/hourly-wage-rules", "/admin/hourly-wages"],
    ["/admin/users/abc/hourly-wage-rules/history", "/admin/hourly-wages"],
    ["/admin/other", "/admin"],
  ])("maps %s to %s", (pathname, guidePath) => {
    expect(getUserGuideUrl("https://help.example.test", pathname)).toBe(
      `https://help.example.test${guidePath}`,
    );
  });

  it("joins paths with or without a trailing slash", () => {
    expect(getUserGuideUrl("https://help.example.test/", "/history")).toBe(
      "https://help.example.test/staff/history",
    );
    expect(getUserGuideUrl("https://help.example.test/docs", "/history")).toBe(
      "https://help.example.test/docs/staff/history",
    );
    expect(
      getUserGuideUrl("https://help.example.test/docs///", "/history"),
    ).toBe("https://help.example.test/docs/staff/history");
  });
});
