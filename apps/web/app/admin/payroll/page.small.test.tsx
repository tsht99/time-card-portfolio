import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect: ${path}`);
  }),
  loadSummary: vi.fn(),
  loadUsers: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../../lib/server/admin-attendance", () => ({
  loadAdminMonthlyPayrollSummary: mocks.loadSummary,
}));
vi.mock("../../../lib/server/admin-user-management", () => ({
  loadAdminUsers: mocks.loadUsers,
}));
vi.mock("./payroll-list-client", () => ({
  PayrollListClient: () => null,
}));

async function loadPage(searchParams: Record<string, string | string[]> = {}) {
  const { default: PayrollListPage } = await import("./page");
  return PayrollListPage({ searchParams: Promise.resolve(searchParams) });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
  mocks.redirect.mockClear();
  mocks.loadSummary
    .mockReset()
    .mockResolvedValue({ status: "ready", data: [] });
  mocks.loadUsers.mockReset().mockResolvedValue({ status: "ready", data: [] });
});

afterEach(() => vi.useRealTimers());

test("month 指定なしは東京時間の当月を initialMonth と fallbackMonth に渡す", async () => {
  const element = await loadPage();

  expect(mocks.loadSummary).toHaveBeenCalledWith("2026-09");
  expect(element.props).toMatchObject({
    initialMonth: "2026-09",
    fallbackMonth: "2026-09",
  });
});

test("有効な month は初期月次データと Client の initialMonth に渡す", async () => {
  const element = await loadPage({ month: "2026-08" });

  expect(mocks.loadSummary).toHaveBeenCalledWith("2026-08");
  expect(element.props).toMatchObject({
    initialMonth: "2026-08",
    fallbackMonth: "2026-09",
  });
});

test("月次サマリーとユーザー一覧の初期 read を並列に開始する", async () => {
  let resolveSummary!: (value: { status: string; data: never[] }) => void;
  let resolveUsers!: (value: { status: string; data: never[] }) => void;
  mocks.loadSummary.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveSummary = resolve;
    }),
  );
  mocks.loadUsers.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveUsers = resolve;
    }),
  );

  const { default: PayrollListPage } = await import("./page");
  const page = PayrollListPage({
    searchParams: Promise.resolve({ month: "2026-08" }),
  });
  await Promise.resolve();

  expect(mocks.loadSummary).toHaveBeenCalledWith("2026-08");
  expect(mocks.loadUsers).toHaveBeenCalledOnce();

  resolveSummary({ status: "ready", data: [] });
  resolveUsers({ status: "ready", data: [] });
  await page;
});

test("不正・空・重複・配列形式の month は取得せず一覧 root へ redirect する", async () => {
  for (const searchParams of [
    { month: "2026-13" },
    { month: "" },
    { month: ["2026-08", "2026-09"] },
    { month: ["2026-08"] },
    { month: "0000-01" },
  ]) {
    mocks.redirect.mockClear();
    mocks.loadSummary.mockClear();
    mocks.loadUsers.mockClear();

    await expect(loadPage(searchParams)).rejects.toThrow(
      "redirect: /admin/payroll",
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/payroll");
    expect(mocks.loadSummary).not.toHaveBeenCalled();
    expect(mocks.loadUsers).not.toHaveBeenCalled();
  }
});
