// cspell:ignore uncomputed

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDetail: vi.fn(),
}));

vi.mock("../../../../../lib/server/admin-attendance", () => ({
  loadAdminUserMonthlyPayrollDetail: mocks.loadDetail,
}));
vi.mock("./payroll-detail-client", () => ({
  PayrollDetailClient: () => null,
}));

const userId = "11111111-1111-4111-8111-111111111111";

async function loadPage(
  requestedUserId = userId,
  searchParams: Record<string, string | string[]> = {},
) {
  const { default: MonthlyPayrollDetailPage } = await import("./page");
  return MonthlyPayrollDetailPage({
    params: Promise.resolve({ userId: requestedUserId }),
    searchParams: Promise.resolve(searchParams),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
  mocks.loadDetail.mockReset().mockResolvedValue({
    status: "ready",
    data: {
      userId,
      month: "2026-08",
      displayName: "対象スタッフ",
      totalEstimatedPayYen: 0,
      uncomputedCount: 0,
      roundingAdjustmentYen: 0,
      attendances: [],
    },
  });
});

afterEach(() => vi.useRealTimers());

test("有効なparamsとmonthだけ既存loaderへ渡す", async () => {
  const initialDetail = {
    status: "ready" as const,
    data: {
      userId,
      month: "2026-08",
      displayName: "対象スタッフ",
      totalEstimatedPayYen: 1200,
      uncomputedCount: 0,
      roundingAdjustmentYen: 0,
      attendances: [],
    },
  };
  mocks.loadDetail.mockResolvedValue(initialDetail);

  const element = await loadPage(userId, { month: "2026-08" });

  expect(mocks.loadDetail).toHaveBeenCalledWith(userId, "2026-08");
  expect(element.props).toMatchObject({
    userId,
    initialMonth: "2026-08",
    fallbackMonth: "2026-09",
    initialDetail,
  });
});

test("month未指定時は東京時間の当月をloaderへ渡す", async () => {
  const element = await loadPage();

  expect(mocks.loadDetail).toHaveBeenCalledWith(userId, "2026-09");
  expect(element.props).toMatchObject({
    initialMonth: "2026-09",
    fallbackMonth: "2026-09",
  });
});

test("不正なuserId・month・配列monthはloaderを呼ばず入力エラーを渡す", async () => {
  const cases = [
    {
      requestedUserId: "not-a-uuid",
      searchParams: { month: "2026-08" },
      message: "対象ユーザーを正しく指定してください。",
    },
    {
      requestedUserId: userId,
      searchParams: { month: "2026-13" },
      message: "対象月を正しく指定してください。",
    },
    {
      requestedUserId: userId,
      searchParams: { month: ["2026-08"] },
      message: "対象月を正しく指定してください。",
    },
  ];

  for (const testCase of cases) {
    mocks.loadDetail.mockClear();
    const element = await loadPage(
      testCase.requestedUserId,
      testCase.searchParams,
    );
    expect(mocks.loadDetail).not.toHaveBeenCalled();
    expect(element.props).toMatchObject({
      inputError: testCase.message,
      initialDetail: { status: "error", message: testCase.message },
    });
  }
});
