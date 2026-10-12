import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadUsers: vi.fn(),
  loadWages: vi.fn(),
  ratesClient: vi.fn(() => null),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("../../../_lib/admin-user-management.ts", () => ({
  loadAdminUsers: mocks.loadUsers,
}));
vi.mock("./_lib/admin-hourly-wage-rules.ts", () => ({
  loadAdminHourlyWageRules: mocks.loadWages,
}));
vi.mock("./_components/hourly-wage-rules-client.tsx", () => ({
  HourlyWageRulesClient: mocks.ratesClient,
}));

beforeEach(() => {
  mocks.loadUsers.mockReset().mockResolvedValue({ status: "ready", data: [] });
  mocks.loadWages.mockReset().mockResolvedValue({ status: "ready", data: [] });
  mocks.ratesClient.mockClear();
  mocks.redirect.mockClear();
});

test("routeのuserIdを共通時給画面へ渡し、ユーザー一覧も読み込む", async () => {
  const { default: UserHourlyWageRulesPage } = await import("./page");
  const initialUsers = { status: "ready" as const, data: [] };
  mocks.loadUsers.mockResolvedValue(initialUsers);

  const element = await UserHourlyWageRulesPage({
    params: Promise.resolve({ userId: "staff-1" }),
  });

  expect(mocks.loadUsers).toHaveBeenCalledOnce();
  expect(element.props.children.props).toMatchObject({
    initialUsers,
    selectedUserId: "staff-1",
    hourlyWageRulesState: { status: "ready", data: [] },
  });
  expect(element.props.children.props.initialReferenceDate).toBeUndefined();
});

test("有効な確認日をClientへ渡す", async () => {
  const { default: UserHourlyWageRulesPage } = await import("./page");
  const element = await UserHourlyWageRulesPage({
    params: Promise.resolve({ userId: "staff-1" }),
    searchParams: Promise.resolve({ date: "2026-09-20" }),
  });
  expect(element.props.children.props.initialReferenceDate).toBe("2026-09-20");
  expect(mocks.redirect).not.toHaveBeenCalled();
});

test.each(["2026-02-30", "2026-9-20", ["2026-09-20", "2026-09-21"]])(
  "不正なdateはcanonical URLへredirectする: %j",
  async (date) => {
    const { default: UserHourlyWageRulesPage } = await import("./page");
    await expect(
      UserHourlyWageRulesPage({
        params: Promise.resolve({ userId: "staff-1" }),
        searchParams: Promise.resolve({ date }),
      }),
    ).rejects.toThrow("REDIRECT:/admin/users/staff-1/hourly-wage-rules");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/admin/users/staff-1/hourly-wage-rules",
    );
  },
);
