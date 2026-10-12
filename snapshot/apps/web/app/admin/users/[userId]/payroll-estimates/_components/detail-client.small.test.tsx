import type { AdminUserMonthlyPayrollEstimateDetail } from "@repo/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AdminUserMonthlyPayrollEstimateDetailState } from "../../../../_lib/admin-payroll-estimate-types.ts";

const mocks = vi.hoisted(() => ({
  reauthenticate: vi.fn(),
  authState: {} as {
    status: "checking" | "ready" | "unavailable" | "error";
    message?: string;
    user?: {
      userId: string;
      displayName: string;
      role: "admin";
      status: "active";
    };
  },
  navigation: {
    url: "",
    listeners: new Set<() => void>(),
    push: vi.fn(),
  },
}));

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({
      push: (url: string) => {
        mocks.navigation.url = url;
        mocks.navigation.push(url);
        for (const listener of mocks.navigation.listeners) listener();
      },
    }),
    useSearchParams: () => {
      React.useSyncExternalStore(
        (listener) => {
          mocks.navigation.listeners.add(listener);
          return () => mocks.navigation.listeners.delete(listener);
        },
        () => mocks.navigation.url,
        () => mocks.navigation.url,
      );
      return new URLSearchParams(mocks.navigation.url.split("?")[1] ?? "");
    },
  };
});

vi.mock("nuqs", async () => {
  const React = await import("react");
  return {
    useQueryState: () => {
      React.useSyncExternalStore(
        (listener) => {
          mocks.navigation.listeners.add(listener);
          return () => mocks.navigation.listeners.delete(listener);
        },
        () => mocks.navigation.url,
        () => mocks.navigation.url,
      );
      const value = new URLSearchParams(
        mocks.navigation.url.split("?")[1] ?? "",
      ).get("month");
      return [
        value,
        (month: string | null) => {
          const url = `/admin/users/${userId}/payroll-estimates?month=${month}`;
          mocks.navigation.url = url;
          mocks.navigation.push(url);
          for (const listener of mocks.navigation.listeners) listener();
          return Promise.resolve();
        },
      ];
    },
  };
});

vi.mock("../../../../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: mocks.authState,
    reauthenticate: mocks.reauthenticate,
  }),
}));

const userId = "11111111-1111-4111-8111-111111111111";

function attendance(
  overrides: Partial<
    AdminUserMonthlyPayrollEstimateDetail["attendances"][number]
  > = {},
) {
  return {
    attendanceId: "attendance-1",
    attendanceDate: "2026-09-22",
    workPeriod: "day" as const,
    clockInAt: "2026-09-22T02:00:00.000Z",
    clockOutAt: "2026-09-22T06:00:00.000Z",
    workedMinutes: 240,
    hourlyWage: 1200,
    estimatedPayYenTimes60: 20,
    estimatedPayYen: 4800,
    status: "calculated" as const,
    ...overrides,
  };
}

function detail(
  overrides: Partial<AdminUserMonthlyPayrollEstimateDetail> = {},
): AdminUserMonthlyPayrollEstimateDetail {
  return {
    userId,
    month: "2026-09",
    displayName: "山田太郎",
    totalEstimatedPayYen: 6200,
    uncomputedCount: 0,
    roundingAdjustmentYen: 0,
    attendances: [attendance()],
    ...overrides,
  };
}

async function renderClient(
  initialDetail: AdminUserMonthlyPayrollEstimateDetailState = {
    status: "ready",
    data: detail(),
  },
  initialMonth = "2026-09",
) {
  mocks.navigation.url = "";
  const { PayrollEstimateDetailClient } = await import("./detail-client");
  render(
    <PayrollEstimateDetailClient
      initialMonth={initialMonth}
      initialDetail={initialDetail}
    />,
  );
}

beforeEach(() => {
  mocks.authState = {
    status: "ready",
    user: {
      userId: "99999999-9999-4999-8999-999999999999",
      displayName: "管理者",
      role: "admin",
      status: "active",
    },
  };
  mocks.navigation.url = "";
  mocks.navigation.listeners.clear();
  mocks.navigation.push.mockReset();
  mocks.reauthenticate.mockReset();
});

afterEach(() => {
  cleanup();
});

test("スタッフ名、対象月、給与見込み、勤怠別の時刻・時給・金額を表示する", async () => {
  await renderClient();

  const userCard = screen.getByRole("region", { name: "対象ユーザー" });
  expect(within(userCard).getByText("山田太郎")).toBeTruthy();
  expect(screen.queryByText("対象ユーザー:")).toBeNull();
  expect(
    screen.getByRole("group", { name: "給与見込み詳細の月ナビゲーション" }),
  ).toBeTruthy();
  expect(screen.getByText("6,200円")).toBeTruthy();
  expect(screen.getByText("9/22（火）")).toBeTruthy();
  expect(screen.getByText("昼")).toBeTruthy();
  expect(screen.getByText("1,200円/時")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /9\/22（火）/ }).getAttribute("href"),
  ).toBe("/admin/attendance/attendance-1");
  expect(screen.getByText("11:00 - 15:00")).toBeTruthy();
  expect(screen.getByText("4時間")).toBeTruthy();
  expect(
    screen.getByRole("region", {
      name: "給与見込み額",
    }),
  ).toBeTruthy();
  expect(
    screen.queryByText(
      "表示金額は税・社会保険等を含む最終支給額ではありません。",
    ),
  ).toBeNull();
});

test("同日複数勤怠を分け、未算出の理由と丸め差を表示額にしない", async () => {
  await renderClient({
    status: "ready",
    data: detail({
      totalEstimatedPayYen: 1001,
      roundingAdjustmentYen: 1,
      uncomputedCount: 3,
      attendances: [
        attendance({ attendanceId: "first", estimatedPayYen: 1000 }),
        attendance({
          attendanceId: "same-day-night",
          workPeriod: "night",
          clockInAt: "2026-09-22T12:00:00.000Z",
          clockOutAt: "2026-09-22T15:00:00.000Z",
          workedMinutes: 180,
          estimatedPayYenTimes60: 20,
          estimatedPayYen: 1000,
        }),
        attendance({
          attendanceId: "second",
          hourlyWage: null,
          estimatedPayYenTimes60: null,
          estimatedPayYen: null,
          status: "missingHourlyWage",
        }),
        attendance({
          attendanceId: "third",
          clockOutAt: null,
          workedMinutes: null,
          estimatedPayYenTimes60: null,
          estimatedPayYen: null,
          status: "clockOutMissing",
        }),
        attendance({
          attendanceId: "fourth",
          clockInAt: "not-a-date",
          clockOutAt: null,
          workedMinutes: null,
          hourlyWage: null,
          estimatedPayYenTimes60: null,
          estimatedPayYen: null,
          status: "incomplete",
        }),
        attendance({
          attendanceId: "zero",
          hourlyWage: 0,
          estimatedPayYenTimes60: 0,
          estimatedPayYen: 0,
        }),
      ],
    }),
  });

  const list = screen.getByRole("list", { name: "勤怠別給与見込み明細" });
  expect(list.querySelectorAll("li")).toHaveLength(7);
  const attendanceLinks = list.querySelectorAll(
    "a[href^='/admin/attendance/']",
  );
  expect(attendanceLinks).toHaveLength(6);
  for (const link of attendanceLinks) {
    expect(link.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  }
  expect(list.querySelector("a[href='/admin/attendance/first']")).toBeTruthy();
  expect(
    list.querySelector("a[href='/admin/attendance/same-day-night']"),
  ).toBeTruthy();
  expect(list.textContent).toContain("1,000円");
  expect(list.textContent).toContain("0円");
  expect(list.textContent).toContain("夜");
  expect(list.textContent).toContain("時給未設定");
  expect(list.textContent).toContain("退勤未記録");
  expect(list.textContent).toContain("勤怠不完全");
  expect(list.textContent).toContain("端数調整 +1円");
  const roundingAdjustment = Array.from(list.querySelectorAll("li")).find(
    (row) => row.textContent?.includes("端数調整 +1円"),
  );
  expect(roundingAdjustment?.querySelector("a")).toBeNull();
  const clockOutMissing = Array.from(list.querySelectorAll("li")).find((row) =>
    row.textContent?.includes("退勤未記録"),
  );
  expect(clockOutMissing?.textContent).toContain("未登録");
  expect(clockOutMissing?.textContent).not.toContain("勤務中");
});

test("勤怠IDをURL用にencodeして行全体をリンクにする", async () => {
  await renderClient({
    status: "ready",
    data: detail({
      attendances: [attendance({ attendanceId: "attendance/a b?" })],
    }),
  });
  expect(
    screen.getByRole("link", { name: /9\/22（火）/ }).getAttribute("href"),
  ).toBe("/admin/attendance/attendance%2Fa%20b%3F");
  expect(
    screen
      .getByRole("link", { name: /9\/22（火）/ })
      .querySelector('svg[aria-hidden="true"]'),
  ).toBeTruthy();
});

test("正負の端数調整を表示する", async () => {
  const positive = detail({
    month: "2026-08",
    totalEstimatedPayYen: 1,
    roundingAdjustmentYen: 1,
    attendances: [
      attendance({
        attendanceId: "positive-1",
        estimatedPayYenTimes60: 29,
        estimatedPayYen: 0,
      }),
      attendance({
        attendanceId: "positive-2",
        attendanceDate: "2026-08-11",
        clockInAt: "2026-08-11T00:00:00.000Z",
        clockOutAt: "2026-08-11T00:01:00.000Z",
        estimatedPayYenTimes60: 29,
        estimatedPayYen: 0,
      }),
    ],
  });
  await renderClient({ status: "ready", data: positive }, "2026-08");
  expect(
    screen.getByRole("region", {
      name: "給与見込み額",
    }).textContent,
  ).toContain("1円");
  expect(screen.getByText("端数調整 +1円")).toBeTruthy();
  expect(
    screen.getByRole("list", { name: "勤怠別給与見込み明細" }).textContent,
  ).toContain("0円");
  expect(screen.queryByText("集計方法")).toBeNull();
  cleanup();

  const negative = detail({
    month: "2026-08",
    totalEstimatedPayYen: 1,
    roundingAdjustmentYen: -1,
    attendances: [
      attendance({
        attendanceId: "negative-1",
        hourlyWage: 30,
        estimatedPayYenTimes60: 30,
        estimatedPayYen: 1,
      }),
      attendance({
        attendanceId: "negative-2",
        attendanceDate: "2026-08-11",
        clockInAt: "2026-08-11T00:00:00.000Z",
        clockOutAt: "2026-08-11T00:01:00.000Z",
        hourlyWage: 30,
        estimatedPayYenTimes60: 30,
        estimatedPayYen: 1,
      }),
    ],
  });
  await renderClient({ status: "ready", data: negative }, "2026-08");
  expect(
    screen.getByRole("region", {
      name: "給与見込み額",
    }).textContent,
  ).toContain("1円");
  expect(screen.getByText("端数調整 -1円")).toBeTruthy();
});

test("月移動は対象スタッフを維持し、取得中は旧月の金額を表示しない", async () => {
  await renderClient();

  fireEvent.click(screen.getByRole("button", { name: "前の月" }));
  expect(mocks.navigation.push).toHaveBeenCalledWith(
    `/admin/users/${userId}/payroll-estimates?month=2026-08`,
  );
  expect(await screen.findByText("給与見込み詳細を読み込み中")).toBeTruthy();
  expect(screen.queryByText("6,200円")).toBeNull();
});

test("初期の0件・取得失敗・対象ユーザー不在を正常表示と区別する", async () => {
  await renderClient({
    status: "ready",
    data: detail({ totalEstimatedPayYen: 0, attendances: [] }),
  });
  expect(screen.getByText("0円")).toBeTruthy();
  expect(screen.getByText("この月の勤怠データはありません")).toBeTruthy();

  cleanup();
  await renderClient({
    status: "error",
    message: "給与見込み詳細を取得できませんでした。",
  });
  expect(
    screen.getByText("給与見込み詳細を取得できませんでした。"),
  ).toBeTruthy();
  expect(screen.queryByText("内部例外")).toBeNull();
  expect(screen.queryByText("6,200円")).toBeNull();
  expect(screen.queryByText("この月の勤怠データはありません")).toBeNull();

  cleanup();
  await renderClient({
    status: "missing",
    message: "対象ユーザーが見つかりません。",
  });
  expect(screen.getByText("対象ユーザーが見つかりません。")).toBeTruthy();
  expect(screen.queryByText("6,200円")).toBeNull();
});

test("URL月とServer Componentの詳細月が異なる場合は結果を表示しない", async () => {
  await renderClient({ status: "ready", data: detail({ month: "2026-08" }) });
  expect(screen.getByText("給与見込み詳細を読み込み中")).toBeTruthy();
  expect(screen.queryByText("6,200円")).toBeNull();
});

test("認証確認中と認証利用不可は詳細を表示しない", async () => {
  mocks.authState = { status: "checking", message: "認証確認中です。" };
  await renderClient();
  expect(screen.getByText("認証確認中です。")).toBeTruthy();
  expect(screen.queryByText("6,200円")).toBeNull();

  cleanup();
  mocks.authState = {
    status: "unavailable",
    message: "管理者権限が必要です。",
  };
  await renderClient();
  expect(screen.getByText("管理者権限が必要です。")).toBeTruthy();
  expect(screen.queryByText("6,200円")).toBeNull();
});
