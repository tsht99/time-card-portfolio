import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedUserSession: vi.fn(),
  getHourlyWageRules: vi.fn(),
  createApplication: vi.fn(),
  report: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../lib/server/auth-session", () => ({
  resolveAuthenticatedUserSession: mocks.resolveAuthenticatedUserSession,
}));
vi.mock("../../../../../../lib/server/payroll-composition", () => ({
  createHourlyWageRuleManagementApplication: mocks.createApplication,
}));
vi.mock("../../../../../../lib/server/server-observability", () => ({
  reportUnexpectedServerException: mocks.report,
}));

afterEach(() => {
  Object.values(mocks).forEach((mock) => {
    mock.mockReset();
  });
});

test("時給読み取りはidentityを解決し、targetとApplication authorization outcomesをstateへ変換する", async () => {
  const { loadAdminHourlyWageRules } = await import(
    "./admin-hourly-wage-rules.ts"
  );
  mocks.resolveAuthenticatedUserSession.mockResolvedValue({
    status: "missing",
    message: "ログインが必要です。",
  });
  await expect(loadAdminHourlyWageRules("staff-1")).resolves.toEqual({
    status: "missing",
    message: "ログインが必要です。",
  });
  expect(mocks.createApplication).not.toHaveBeenCalled();

  mocks.resolveAuthenticatedUserSession.mockResolvedValue({
    status: "ready",
    user: { userId: "admin" },
  });
  mocks.createApplication.mockReturnValue({
    getHourlyWageRules: mocks.getHourlyWageRules,
  });
  mocks.getHourlyWageRules.mockResolvedValue({ kind: "user-not-found" });
  await expect(loadAdminHourlyWageRules("missing-user")).resolves.toEqual({
    status: "missing",
    message: "対象ユーザーが見つかりません。",
  });

  mocks.getHourlyWageRules.mockResolvedValue({ kind: "role-forbidden" });
  await expect(loadAdminHourlyWageRules("admin-2")).resolves.toEqual({
    status: "unavailable",
    code: "ADMIN_ACCESS_REQUIRED",
    message: "この操作を行う権限がありません。",
  });

  const failure = new Error("database failure");
  mocks.getHourlyWageRules.mockRejectedValue(failure);
  await expect(loadAdminHourlyWageRules("staff-1")).resolves.toEqual({
    status: "error",
    message: "時給ルールの履歴を取得できませんでした。",
  });
  expect(mocks.report).toHaveBeenCalledWith(
    failure,
    "admin.hourly-wage-rules.read",
  );
});
