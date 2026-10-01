import { describe, expect, test } from "vitest";
import {
  adminNavigationItems,
  getActiveAdminNavigationHref,
  getAdminPageTitle,
} from "./admin-shell-navigation.ts";

test("管理画面のナビゲーション項目を固定順で定義する", () => {
  expect(adminNavigationItems).toEqual([
    { href: "/admin/attendance", label: "勤怠" },
    { href: "/admin/payroll", label: "給与" },
    { href: "/admin/users", label: "ユーザー" },
  ]);
});

describe("管理画面のページタイトル", () => {
  test.each([
    ["/admin/attendance", "勤怠一覧"],
    ["/admin/attendance/new", "勤怠作成"],
    ["/admin/payroll", "給与一覧"],
    ["/admin/users/staff-1/hourly-wage-rates", "時給設定"],
    ["/admin/users/staff-1/hourly-wage-rates/history", "時給履歴"],
    ["/admin/users", "ユーザー一覧"],
    ["/admin/users/admin-1", "ユーザー詳細"],
    ["/admin/users/staff-1/payroll", "給与詳細"],
    ["/admin/attendance/attendance-1", "勤怠詳細"],
    ["/admin/attendance/attendance-1/edit", "勤怠訂正"],
  ])("%s のタイトルは %s", (pathname, title) => {
    expect(getAdminPageTitle(pathname)).toBe(title);
  });

  test("既知のページをprefixで誤分類しない", () => {
    expect(getAdminPageTitle("/admin/attendance-history")).toBe("管理画面");
    expect(
      getAdminPageTitle("/admin/attendance/attendance-1/edit/preview"),
    ).toBe("管理画面");
    expect(getAdminPageTitle("/admin/users/admin-1/extra")).toBe("管理画面");
    expect(getAdminPageTitle("/admin/users/staff-1/payroll/extra")).toBe(
      "管理画面",
    );
  });
});

test("既知 pathname は所属する管理領域に割り当て、未知の類似 prefix は分類しない", () => {
  for (const pathname of [
    "/admin/attendance",
    "/admin/attendance/new",
    "/admin/attendance/attendance-1",
    "/admin/attendance/attendance-1/edit",
  ]) {
    expect(getActiveAdminNavigationHref(pathname)).toBe("/admin/attendance");
  }
  for (const pathname of ["/admin/payroll", "/admin/users/staff-1/payroll"]) {
    expect(getActiveAdminNavigationHref(pathname)).toBe("/admin/payroll");
  }
  for (const pathname of [
    "/admin/users",
    "/admin/users/staff-1",
    "/admin/users/staff-1/hourly-wage-rates",
    "/admin/users/staff-1/hourly-wage-rates/history",
  ]) {
    expect(getActiveAdminNavigationHref(pathname)).toBe("/admin/users");
  }
  for (const pathname of [
    "/admin/attendance-history",
    "/admin/attendance/attendance-1/edit/preview",
    "/admin/payroll-extra",
    "/admin/users-extra",
    "/admin/users/staff-1/payroll/extra",
    "/admin/users/staff-1/hourly-wage-rates/history/extra",
  ]) {
    expect(getActiveAdminNavigationHref(pathname)).toBeUndefined();
  }
});
