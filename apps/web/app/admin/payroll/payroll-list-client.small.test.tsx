import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";

const mocks = vi.hoisted(() => ({
  reauthenticate: vi.fn(),
  readSummary: vi.fn(),
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
  },
}));

vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
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

function updateNavigationUrl(url: string) {
  mocks.navigation.url = url;
  for (const listener of mocks.navigation.listeners) listener();
}

vi.mock("../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: mocks.authState,
    reauthenticate: mocks.reauthenticate,
  }),
}));
vi.mock("../_actions/attendance-actions.ts", () => ({
  getAdminMonthlyPayrollSummaryAction: mocks.readSummary,
}));

const users = [
  {
    userId: "staff-1",
    displayName: "有効スタッフ",
    role: "staff" as const,
    status: "active" as const,
  },
  {
    userId: "staff-2",
    displayName: "警告のみスタッフ",
    role: "staff" as const,
    status: "active" as const,
  },
  {
    userId: "staff-3",
    displayName: "勤務中スタッフ",
    role: "staff" as const,
    status: "active" as const,
  },
  {
    userId: "staff-4",
    displayName: "両方スタッフ",
    role: "staff" as const,
    status: "active" as const,
  },
];

async function renderClient(
  initialSummary: Parameters<
    typeof import("./payroll-list-client")["PayrollListClient"]
  >[0]["initialSummary"] = { status: "ready", data: [] },
  initialMonth = "2026-09",
  url = "",
  initialUsers: AdminUsersState = { status: "ready", data: users },
) {
  mocks.navigation.url = url;
  const { PayrollListClient } = await import("./payroll-list-client");
  const { QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PayrollListClient
        initialMonth={initialMonth}
        initialSummary={initialSummary}
        initialUsers={initialUsers}
      />
    </QueryClientProvider>,
  );
}

function openMonthPicker() {
  fireEvent.click(screen.getByRole("button", { name: "月を直接選択" }));
  return screen.getByLabelText("月を直接選択") as HTMLInputElement;
}

beforeEach(() => {
  mocks.authState = {
    status: "ready",
    user: {
      userId: "admin-1",
      displayName: "管理者",
      role: "admin",
      status: "active",
    },
  };
  mocks.navigation.url = "";
  mocks.navigation.listeners.clear();
  vi.spyOn(window.history, "pushState").mockImplementation(
    (_data, _unused, url) => {
      if (typeof url === "string") updateNavigationUrl(url);
    },
  );
  mocks.reauthenticate.mockReset().mockResolvedValue(undefined);
  mocks.readSummary
    .mockReset()
    .mockResolvedValueOnce({ status: "missing", message: "期限切れ" })
    .mockResolvedValueOnce({
      status: "ready",
      data: [
        {
          userId: "staff-1",
          incompleteCount: 0,
          missingHourlyWageCount: 0,
          hasWorkingAttendance: false,
          otherIncompleteCount: 0,
          totalWorkedMinutes: 0,
          totalEstimatedPayYen: 120000,
        },
      ],
    });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("動的な月次取得のSESSION_EXPIREDは再認証後に一度だけ再試行する", async () => {
  await renderClient();

  expect(
    screen.getByRole("main").querySelector('a[href$="/hourly-wage-rates"]'),
  ).toBeNull();

  const monthInput = openMonthPicker();
  expect(monthInput.type).toBe("month");
  expect(monthInput.value).toBe("2026-09");
  fireEvent.change(monthInput, {
    target: { value: "2026-08" },
  });
  await waitFor(() => {
    expect(mocks.readSummary).toHaveBeenCalledTimes(2);
    expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
  });
  expect(await screen.findByText("120,000円")).toBeTruthy();
});

test("退勤未記録だけがある利用者には要確認だけを表示し、詳細な集計情報は表示しない", async () => {
  mocks.readSummary.mockReset().mockResolvedValue({
    status: "ready",
    data: [
      {
        userId: "staff-1",
        incompleteCount: 1,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: true,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 510,
        totalEstimatedPayYen: 120000,
      },
    ],
  });
  await renderClient();
  fireEvent.change(openMonthPicker(), {
    target: { value: "2026-08" },
  });
  const riskLink = await screen.findByRole("link", {
    name: "有効スタッフの給与詳細へ移動",
  });
  expect(within(riskLink).getByText("要確認")).toBeTruthy();
  expect(within(riskLink).queryByText("退勤未記録")).toBeNull();
  expect(within(riskLink).getByText("120,000円")).toBeTruthy();
  expect(screen.queryByText("勤務時間")).toBeNull();
  expect(screen.queryByText("集計方法")).toBeNull();
  expect(screen.queryByText("不完全勤怠 1件")).toBeNull();
  expect(screen.queryByText("時給未設定 2件")).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  const detailLink = screen.getByRole("link", {
    name: "有効スタッフの給与詳細へ移動",
  });
  expect(detailLink.getAttribute("href")).toBe(
    "/admin/users/staff-1/payroll?month=2026-08",
  );
});

test("問題のないスタッフは簡潔な給与カードを表示する", async () => {
  await renderClient({
    status: "ready",
    data: [
      {
        userId: "staff-1",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 5000,
      },
    ],
  });
  expect(await screen.findByText("有効スタッフ")).toBeTruthy();
  expect(screen.getByText("有効スタッフ")).toBeTruthy();
  expect(screen.getByText("5,000円")).toBeTruthy();
  expect(screen.queryByText("要確認")).toBeNull();
  expect(screen.queryByText("退勤未記録")).toBeNull();
  expect(screen.queryByText("勤務時間")).toBeNull();
  expect(screen.queryByText("集計方法")).toBeNull();
});

test("一覧はスタッフごとの給与と詳細リンクを表示する", async () => {
  await renderClient({
    status: "ready",
    data: [
      {
        userId: "staff-1",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 5000,
      },
      {
        userId: "staff-2",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 4000,
      },
    ],
  });

  const items = within(
    screen.getByRole("list", { name: "給与一覧" }),
  ).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(
    screen.getByRole("link", { name: "有効スタッフの給与詳細へ移動" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "警告のみスタッフの給与詳細へ移動" }),
  ).toBeTruthy();
});

test("URL の月に応じて一覧と詳細リンクを切り替え、戻すと initialSummary に戻る", async () => {
  mocks.readSummary.mockReset().mockResolvedValue({
    status: "ready",
    data: [
      {
        userId: "staff-1",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 8000,
      },
    ],
  });
  await renderClient(
    {
      status: "ready",
      data: [
        {
          userId: "staff-1",
          incompleteCount: 0,
          missingHourlyWageCount: 0,
          hasWorkingAttendance: false,
          otherIncompleteCount: 0,
          totalWorkedMinutes: 60,
          totalEstimatedPayYen: 9000,
        },
      ],
    },
    "2026-09",
    "/admin/payroll?month=2026-08",
  );

  expect(await screen.findByText("8,000円")).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "/admin/users/staff-1/payroll?month=2026-08",
  );

  mocks.navigation.url = "/admin/payroll?month=2026-09";
  for (const listener of mocks.navigation.listeners) listener();
  expect(await screen.findByText("9,000円")).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "/admin/users/staff-1/payroll?month=2026-09",
  );
});

test("確認事項が重複しても要確認だけを一度表示し、全体補足は一か所だけ表示する", async () => {
  await renderClient({
    status: "ready",
    data: [
      {
        userId: "staff-2",
        incompleteCount: 1,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 1,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 2000,
      },
      {
        userId: "staff-3",
        incompleteCount: 1,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: true,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 3000,
      },
      {
        userId: "staff-4",
        incompleteCount: 2,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: true,
        otherIncompleteCount: 1,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 4000,
      },
      {
        userId: "staff-1",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 1000,
      },
    ],
  });

  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(4);
  expect(rows[0]?.textContent).toContain("両方スタッフ");
  expect(rows[0]?.textContent).toContain("要確認");
  expect(rows[0]?.textContent).not.toContain("退勤未記録");
  expect(rows[0]?.textContent?.match(/要確認/g)).toHaveLength(1);
  expect(rows[1]?.textContent).toContain("勤務中スタッフ");
  expect(rows[1]?.textContent).not.toContain("退勤未記録");
  expect(rows[1]?.textContent?.match(/要確認/g)).toHaveLength(1);
  expect(rows[2]?.textContent).toContain("警告のみスタッフ");
  expect(rows[2]?.textContent).toContain("要確認");
  expect(rows[2]?.textContent).not.toContain("退勤未記録");
  expect(rows[3]?.textContent).toContain("有効スタッフ");
  expect(rows[3]?.textContent).not.toContain("要確認");
  expect(rows[3]?.textContent).not.toContain("勤務中");
  expect(rows[3]?.textContent).not.toContain("退勤未記録");
  expect(
    screen.queryByText(
      "表示金額は税・社会保険等を含む最終支給額ではありません。",
    ),
  ).toBeNull();
  expect(screen.queryByText("集計方法")).toBeNull();
});

test("初期表示と月切り替え後を給与降順、同額はuserId昇順で表示する", async () => {
  await renderClient({
    status: "ready",
    data: [
      {
        userId: "staff-2",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 5000,
      },
      {
        userId: "staff-1",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 5000,
      },
    ],
  });

  let rows = screen.getAllByRole("listitem");
  expect(rows[0]?.textContent).toContain("有効スタッフ");
  expect(rows[1]?.textContent).toContain("警告のみスタッフ");

  mocks.readSummary.mockReset().mockResolvedValue({
    status: "ready",
    data: [
      {
        userId: "staff-1",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 9000,
      },
      {
        userId: "staff-2",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 60,
        totalEstimatedPayYen: 12000,
      },
    ],
  });
  fireEvent.change(openMonthPicker(), {
    target: { value: "2026-08" },
  });
  await waitFor(() => {
    rows = screen.getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("警告のみスタッフ");
    expect(rows[1]?.textContent).toContain("有効スタッフ");
  });
});

test("前月・翌月・直接選択は期待する月のActionを呼ぶ", async () => {
  mocks.readSummary
    .mockReset()
    .mockResolvedValue({ status: "ready", data: [] });
  await renderClient();
  fireEvent.click(screen.getByRole("button", { name: "前の月" }));
  expect(window.history.pushState).toHaveBeenCalledWith(
    null,
    "",
    "/admin/payroll?month=2026-08",
  );
  await waitFor(() =>
    expect(mocks.readSummary).toHaveBeenCalledWith({ month: "2026-08" }),
  );

  cleanup();
  mocks.readSummary
    .mockReset()
    .mockResolvedValue({ status: "ready", data: [] });
  await renderClient({ status: "ready", data: [] }, "2026-08");
  fireEvent.click(screen.getByRole("button", { name: "次の月" }));
  expect(window.history.pushState).toHaveBeenCalledWith(
    null,
    "",
    "/admin/payroll?month=2026-09",
  );
  await waitFor(() =>
    expect(mocks.readSummary).toHaveBeenCalledWith({ month: "2026-09" }),
  );

  cleanup();
  mocks.readSummary
    .mockReset()
    .mockResolvedValue({ status: "ready", data: [] });
  await renderClient();
  fireEvent.change(openMonthPicker(), {
    target: { value: "2027-01" },
  });
  expect(window.history.pushState).toHaveBeenCalledWith(
    null,
    "",
    "/admin/payroll?month=2027-01",
  );
  await waitFor(() =>
    expect(mocks.readSummary).toHaveBeenCalledWith({ month: "2027-01" }),
  );
});

test("月ナビゲーションはアクセシブルな名前と年月を表示し、直接選択を中止できる", async () => {
  await renderClient();

  expect(
    screen.getByRole("group", { name: "給与一覧の月ナビゲーション" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "2026年9月" })).toBeTruthy();

  const monthInput = openMonthPicker();
  expect(monthInput.value).toBe("2026-09");
  fireEvent.click(screen.getByRole("button", { name: "月選択を中止" }));
  expect(
    screen.queryByLabelText("月を直接選択", { selector: "input" }),
  ).toBeNull();
  expect(screen.getByRole("heading", { name: "2026年9月" })).toBeTruthy();
});

test("直接選択は有効な月だけを反映して入力欄を閉じる", async () => {
  mocks.readSummary
    .mockReset()
    .mockResolvedValue({ status: "ready", data: [] });
  await renderClient();

  const monthInput = openMonthPicker();
  fireEvent.change(monthInput, { target: { value: "2027-01" } });
  await waitFor(() =>
    expect(mocks.readSummary).toHaveBeenCalledWith({ month: "2027-01" }),
  );
  expect(
    screen.queryByLabelText("月を直接選択", { selector: "input" }),
  ).toBeNull();
  expect(screen.getByRole("heading", { name: "2027年1月" })).toBeTruthy();
});

test("年を跨ぐ移動と上下端のdisabledを方向ごとに維持する", async () => {
  mocks.readSummary
    .mockReset()
    .mockResolvedValue({ status: "ready", data: [] });
  await renderClient({ status: "ready", data: [] }, "2026-01");

  fireEvent.click(screen.getByRole("button", { name: "前の月" }));
  expect(window.history.pushState).toHaveBeenCalledWith(
    null,
    "",
    "/admin/payroll?month=2025-12",
  );
  await waitFor(() =>
    expect(mocks.readSummary).toHaveBeenCalledWith({ month: "2025-12" }),
  );

  cleanup();
  await renderClient({ status: "ready", data: [] }, "0001-01");
  expect(
    (screen.getByRole("button", { name: "前の月" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "次の月" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);

  cleanup();
  await renderClient({ status: "ready", data: [] }, "9999-12");
  expect(
    (screen.getByRole("button", { name: "前の月" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(
    (screen.getByRole("button", { name: "次の月" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test("0件、読み込み中、取得失敗を区別して表示する", async () => {
  mocks.readSummary
    .mockReset()
    .mockResolvedValue({ status: "ready", data: [] });
  await renderClient();
  fireEvent.change(openMonthPicker(), {
    target: { value: "2026-08" },
  });
  expect(
    await screen.findByText("この月の勤怠データはありません"),
  ).toBeTruthy();

  cleanup();
  mocks.readSummary.mockImplementation(() => new Promise(() => undefined));
  await renderClient();
  fireEvent.change(openMonthPicker(), {
    target: { value: "2026-08" },
  });
  expect(await screen.findByText("給与一覧を読み込み中")).toBeTruthy();

  cleanup();
  mocks.readSummary.mockRejectedValue(new Error("取得失敗"));
  await renderClient();
  fireEvent.change(openMonthPicker(), {
    target: { value: "2026-08" },
  });
  expect(await screen.findByText("取得失敗")).toBeTruthy();
});

test("初期0件と取得失敗を金額として表示しない", async () => {
  await renderClient({ status: "ready", data: [] });
  expect(screen.getByText("この月の勤怠データはありません")).toBeTruthy();
  expect(screen.queryByText(/¥/)).toBeNull();

  cleanup();
  await renderClient({
    status: "error",
    message: "給与一覧を取得できませんでした。",
  });

  expect(
    await screen.findByText("給与一覧を取得できませんでした。"),
  ).toBeTruthy();
  expect(screen.queryByText("この月の勤怠データはありません")).toBeNull();
  expect(screen.queryByText(/¥/)).toBeNull();
});

test("スタッフを対応付けられない給与データは表示しない", async () => {
  const summary = {
    status: "ready" as const,
    data: [
      {
        userId: "staff-1",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 0,
        totalEstimatedPayYen: 120000,
      },
    ],
  };
  await renderClient(summary, "2026-09", "", {
    status: "error",
    message: "ユーザー一覧を取得できませんでした。",
  });
  expect(
    await screen.findByText("ユーザー一覧を取得できませんでした。"),
  ).toBeTruthy();
  expect(screen.queryByText("staff-1")).toBeNull();
  expect(screen.queryByText("120,000円")).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();

  cleanup();
  await renderClient(summary, "2026-09", "", { status: "ready", data: [] });
  expect(
    await screen.findByText("スタッフ名を取得できない給与データがあります。"),
  ).toBeTruthy();
  expect(screen.queryByText("staff-1")).toBeNull();
  expect(screen.queryByText("120,000円")).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
});

test("displayNameがないスタッフの給与を表示しない", async () => {
  await renderClient(
    {
      status: "ready",
      data: [
        {
          userId: "staff-1",
          incompleteCount: 0,
          missingHourlyWageCount: 0,
          hasWorkingAttendance: false,
          otherIncompleteCount: 0,
          totalWorkedMinutes: 0,
          totalEstimatedPayYen: 120000,
        },
      ],
    },
    "2026-09",
    "",
    {
      status: "ready",
      data: [
        {
          userId: "staff-1",
          displayName: null,
          role: "staff",
          status: "active",
        },
      ],
    },
  );
  expect(
    await screen.findByText("スタッフ名を取得できない給与データがあります。"),
  ).toBeTruthy();
  expect(screen.queryByText("staff-1")).toBeNull();
  expect(screen.queryByText("120,000円")).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
});

test("不正な月では月次Actionを呼ばない", async () => {
  await renderClient();
  fireEvent.change(openMonthPicker(), { target: { value: "2026-13" } });
  expect(screen.getByRole("heading", { name: "2026年9月" })).toBeTruthy();
  expect(mocks.readSummary).not.toHaveBeenCalled();
});

test("認証確認中と認証利用不可は集計結果と区別して表示する", async () => {
  mocks.authState = { status: "checking", message: "認証確認中です。" };
  await renderClient({
    status: "ready",
    data: [
      {
        userId: "staff-1",
        incompleteCount: 0,
        missingHourlyWageCount: 0,
        hasWorkingAttendance: false,
        otherIncompleteCount: 0,
        totalWorkedMinutes: 0,
        totalEstimatedPayYen: 0,
      },
    ],
  });
  expect(screen.getByText("認証確認中です。")).toBeTruthy();
  expect(screen.queryByText("有効スタッフ")).toBeNull();

  cleanup();
  mocks.authState = {
    status: "unavailable",
    message: "管理者権限が必要です。",
  };
  await renderClient({ status: "ready", data: [] });
  expect(screen.getByText("管理者権限が必要です。")).toBeTruthy();
  expect(screen.queryByText("この月の勤怠データはありません")).toBeNull();
});
