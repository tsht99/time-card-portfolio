import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AdminHourlyWageRulesState } from "../../_lib/admin-hourly-wage-rules-types.ts";

const mocks = vi.hoisted(() => ({
  hourlyWageRules: vi.fn(),
  reauthenticate: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  currentUserId: "admin",
  isRouteDataReady: true,
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => mocks.refresh() }),
}));

vi.mock("../../../../../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: {
      status: "ready",
      user: {
        userId: mocks.currentUserId,
        displayName: "管理者",
        role: "admin",
        status: "active",
      },
    },
    reauthenticate: mocks.reauthenticate,
    isSubjectCurrent: true,
    isRouteDataReady: mocks.isRouteDataReady,
    canMutate: () => true,
  }),
}));
vi.mock("../../../../../_actions/payroll-actions.ts", () => ({
  updateAdminHourlyWageRuleAction: mocks.update,
  deleteAdminHourlyWageRuleAction: mocks.remove,
}));

const baseHourlyWageRule = {
  userId: "staff-1",
  workPeriod: "day",
  dayType: "mon",
  hourlyWage: 1200,
  effectiveFrom: "2026-04-01",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const users = {
  status: "ready" as const,
  data: [
    {
      userId: "staff-1",
      displayName: "田中 太郎",
      role: "staff" as "staff" | "admin",
      status: "active" as const,
    },
  ],
};
function first<T>(items: T[]): T {
  const item = items[0];
  if (!item) throw new Error("Expected at least one item");
  return item;
}

async function renderHistory() {
  const { HourlyWageRuleHistory } = await import("./hourly-wage-rule-history");
  const hourlyWageRulesState = await mocks.hourlyWageRules({
    userId: "staff-1",
  });
  let setStateRef:
    | ((state: Awaited<ReturnType<typeof mocks.hourlyWageRules>>) => void)
    | undefined;
  mocks.refresh.mockImplementation(() => {
    void mocks
      .hourlyWageRules({ userId: "staff-1" })
      .then((state: AdminHourlyWageRulesState) => setStateRef?.(state));
  });
  function HistoryRouteHarness() {
    const [state, setState] = useState(hourlyWageRulesState);
    setStateRef = setState;
    return (
      <HourlyWageRuleHistory
        initialUsers={users}
        userId="staff-1"
        hourlyWageRulesState={state}
      />
    );
  }
  const view = render(<HistoryRouteHarness />);
  return {
    setServerState: (
      state: Awaited<ReturnType<typeof mocks.hourlyWageRules>>,
    ) => setStateRef?.(state),
    rerender: () => view.rerender(<HistoryRouteHarness />),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T03:00:00.000Z"));
  mocks.hourlyWageRules.mockReset();
  mocks.reauthenticate.mockReset();
  mocks.update.mockReset();
  mocks.remove.mockReset();
  mocks.currentUserId = "admin";
  mocks.isRouteDataReady = true;
  mocks.refresh.mockReset();
  users.data[0].role = "staff";
  users.data[0].userId = "staff-1";
  mocks.hourlyWageRules.mockResolvedValue({
    status: "ready",
    data: [
      { ...baseHourlyWageRule, id: "apr-day", hourlyWage: 1200 },
      {
        ...baseHourlyWageRule,
        id: "apr-night",
        workPeriod: "night",
        hourlyWage: 1300,
      },
      {
        ...baseHourlyWageRule,
        id: "oct-mon",
        hourlyWage: 1250,
        effectiveFrom: "2026-10-01",
      },
      {
        ...baseHourlyWageRule,
        id: "oct-tue",
        dayType: "tue",
        hourlyWage: 1200,
        effectiveFrom: "2026-10-01",
      },
      {
        ...baseHourlyWageRule,
        id: "oct-sat",
        dayType: "sat",
        workPeriod: "night",
        hourlyWage: 1400,
        effectiveFrom: "2026-10-01",
      },
      {
        ...baseHourlyWageRule,
        id: "nov-mon",
        hourlyWage: 1300,
        effectiveFrom: "2026-11-01",
      },
      {
        ...baseHourlyWageRule,
        id: "nov-sat",
        dayType: "sat",
        workPeriod: "night",
        hourlyWage: 1500,
        effectiveFrom: "2026-11-01",
      },
      {
        ...baseHourlyWageRule,
        id: "nov-holiday",
        dayType: "holiday",
        hourlyWage: 1800,
        effectiveFrom: "2026-11-01",
      },
      {
        ...baseHourlyWageRule,
        id: "nov-sun",
        dayType: "sun",
        workPeriod: "night",
        hourlyWage: 1700,
        effectiveFrom: "2026-11-01",
      },
      {
        ...baseHourlyWageRule,
        id: "nov-sat-day",
        dayType: "sat",
        hourlyWage: 1600,
        effectiveFrom: "2026-11-01",
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("時給履歴", () => {
  test("適用開始日ごとにまとめ、前値と曜日・昼夜順を表示する", async () => {
    await renderHistory();
    expect(
      screen.queryByRole("heading", { level: 1, name: "時給履歴" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "時給設定へ戻る" })).toBeNull();
    const userCard = await screen.findByRole("region", {
      name: "対象ユーザー",
    });
    expect(within(userCard).getByText("田中 太郎")).toBeTruthy();
    expect(screen.queryByText("対象ユーザー:")).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "適用予定" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "過去の変更" })).toBeTruthy();
    const plannedSection = screen.getByRole("region", { name: "適用予定" });
    const pastSection = screen.getByRole("region", { name: "過去の変更" });
    expect(
      within(plannedSection).getByRole("heading", {
        name: "2026/11/01から",
      }),
    ).toBeTruthy();
    expect(
      within(pastSection).getByRole("heading", {
        name: "2026/10/01から",
      }),
    ).toBeTruthy();
    expect(
      within(pastSection).getByRole("heading", {
        name: "2026/04/01から",
      }),
    ).toBeTruthy();
    expect(
      within(plannedSection).queryByRole("heading", {
        name: "2026/10/01から",
      }),
    ).toBeNull();

    const nov = screen
      .getByRole("heading", { name: "2026/11/01から" })
      .closest("article");
    if (!nov) throw new Error("November history group not found");
    expect(
      within(nov)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("月昼1,250円 → 1,300円"),
      expect.stringContaining("土昼未設定 → 1,600円"),
      expect.stringContaining("土夜1,400円 → 1,500円"),
      expect.stringContaining("日夜未設定 → 1,700円"),
      expect.stringContaining("祝日昼未設定 → 1,800円"),
    ]);
    const novemberItems = within(nov).getAllByRole("listitem");
    const saturdayItem = novemberItems[1];
    const sundayItem = novemberItems[3];
    if (!saturdayItem || !sundayItem) throw new Error("Weekday rows not found");
    expect(within(saturdayItem).getByText("土")).toBeTruthy();
    expect(within(sundayItem).getByText("日")).toBeTruthy();

    const oct = screen
      .getByRole("heading", { name: "2026/10/01から" })
      .closest("article");
    if (!oct) throw new Error("October history group not found");
    expect(
      within(oct)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("月昼1,200円 → 1,250円"),
      expect.stringContaining("火昼未設定 → 1,200円"),
      expect.stringContaining("土夜未設定 → 1,400円"),
    ]);
    expect(
      screen
        .getAllByRole("heading", { name: /から$/ })
        .map((heading) => heading.textContent),
    ).toEqual(["2026/11/01から", "2026/10/01から", "2026/04/01から"]);
    expect(mocks.hourlyWageRules).toHaveBeenCalledTimes(1);
    expect(mocks.hourlyWageRules).toHaveBeenCalledWith({ userId: "staff-1" });
  });

  test("UTC日付と日本日付が異なる境界でも今日を過去側にする", async () => {
    vi.setSystemTime(new Date("2026-10-14T15:00:00.000Z"));
    mocks.hourlyWageRules.mockResolvedValue({
      status: "ready",
      data: [
        { ...baseHourlyWageRule, id: "today", effectiveFrom: "2026-10-15" },
        { ...baseHourlyWageRule, id: "tomorrow", effectiveFrom: "2026-10-16" },
      ],
    });
    await renderHistory();
    expect(
      await screen.findByRole("heading", { name: "過去の変更" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "適用予定" }),
    ).toBeTruthy();
    const plannedSection = screen.getByRole("region", { name: "適用予定" });
    const pastSection = screen.getByRole("region", { name: "過去の変更" });
    expect(
      within(pastSection).getByRole("heading", {
        name: "2026/10/15から",
      }),
    ).toBeTruthy();
    expect(
      within(plannedSection).getByRole("heading", {
        name: "2026/10/16から",
      }),
    ).toBeTruthy();
    expect(
      within(plannedSection).queryByRole("heading", {
        name: "2026/10/15から",
      }),
    ).toBeNull();
    expect(
      within(pastSection).queryByRole("heading", {
        name: "2026/10/16から",
      }),
    ).toBeNull();
  });

  test("Server Componentの読み取りstateを表示し、client再認証は呼ばない", async () => {
    mocks.hourlyWageRules
      .mockResolvedValueOnce({
        status: "missing",
        message: "ログイン状態が切れています。",
      })
      .mockResolvedValueOnce({
        status: "ready",
        data: [{ ...baseHourlyWageRule, id: "read-after-reauth" }],
      });
    mocks.reauthenticate.mockResolvedValue(undefined);
    await renderHistory();
    expect(
      await screen.findByText("ログイン状態が切れています。"),
    ).toBeTruthy();
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
    expect(mocks.hourlyWageRules).toHaveBeenCalledTimes(1);
    expect(mocks.hourlyWageRules).toHaveBeenLastCalledWith({
      userId: "staff-1",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  test("読み取りActionのエラーを表示し、再認証は行わない", async () => {
    mocks.hourlyWageRules.mockResolvedValue({
      status: "error",
      code: "USER_NOT_FOUND",
      message: "対象ユーザーが見つかりません。",
    });
    await renderHistory();
    expect(
      await screen.findByText("対象ユーザーが見つかりません。"),
    ).toBeTruthy();
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  test("履歴が0件なら簡潔な空状態を表示する", async () => {
    mocks.hourlyWageRules.mockResolvedValue({ status: "ready", data: [] });
    await renderHistory();
    expect(await screen.findByText("時給履歴はありません。")).toBeTruthy();
  });

  test("変更可能な履歴行に訂正・削除操作があり、訂正フォームに現在値を表示する", async () => {
    await renderHistory();
    const editButtons = await screen.findAllByRole("button", {
      name: "時給ルールを訂正",
    });
    expect(editButtons.length).toBeGreaterThan(0);
    await fireEvent.click(first(editButtons));
    expect(
      await screen.findByRole("heading", { name: "時給ルールを訂正" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "勤務区分" }).textContent,
    ).toContain("昼");
    expect(
      screen.getByRole("combobox", { name: "日区分" }).textContent,
    ).toContain("月");
    expect(screen.getByRole("spinbutton", { name: "時給" })).toHaveProperty(
      "value",
      "1300",
    );
    expect(screen.getByLabelText("適用開始日")).toHaveProperty(
      "value",
      "2026-11-01",
    );
  });

  test("読み取り失敗後も古い訂正Dialogの入力を保つが、再読込が成功するまで送信を止める", async () => {
    const route = await renderHistory();
    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを訂正" })),
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "時給" }), {
      target: { value: "1777" },
    });

    mocks.isRouteDataReady = false;
    route.setServerState({
      status: "error",
      code: "READ_FAILED",
      message: "時給履歴を取得できませんでした。",
    });
    route.rerender();

    expect(
      await screen.findByText("時給履歴を取得できませんでした。"),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "時給ルールを訂正" }),
    ).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "時給" })).toHaveProperty(
      "value",
      "1777",
    );
    expect(screen.getByRole("button", { name: "訂正する" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(mocks.update).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "訂正する" }));
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("訂正は対象idとversionを送り、成功後に履歴を再取得する", async () => {
    await renderHistory();
    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを訂正" })),
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "時給" }), {
      target: { value: "1280" },
    });
    mocks.update.mockResolvedValue({ data: undefined });
    fireEvent.click(screen.getByRole("button", { name: "訂正する" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        userId: "staff-1",
        hourlyWageRuleId: "nov-mon",
        expectedVersion: 1,
        workPeriod: "day",
        dayType: "mon",
        hourlyWage: 1280,
        effectiveFrom: "2026-11-01",
      }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("heading", { name: "時給ルールを訂正" }),
    ).toBeNull();
  });

  test("訂正のversion conflictは成功扱いにせず、最新履歴を再取得してDialogを閉じる", async () => {
    await renderHistory();
    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを訂正" })),
    );
    mocks.update.mockResolvedValue({
      serverError: {
        code: "HOURLY_WAGE_RULE_VERSION_CONFLICT",
        message: "訂正時に競合しました。",
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "訂正する" }));
    expect(await screen.findByText("訂正時に競合しました。")).toBeTruthy();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("heading", { name: "時給ルールを訂正" }),
    ).toBeNull();
  });

  test("時給が空欄なら0円に変換せず入力エラーにする", async () => {
    await renderHistory();
    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを訂正" })),
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "時給" }), {
      target: { value: "" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "訂正する" }));
    expect(await screen.findByText("時給を入力してください。")).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test("削除の確認情報と競合を表示し、キャンセルはActionを呼ばない", async () => {
    await renderHistory();
    const deletes = await screen.findAllByRole("button", {
      name: "時給ルールを削除",
    });
    await fireEvent.click(first(deletes));
    expect(
      await screen.findByRole("heading", { name: "時給ルールを削除" }),
    ).toBeTruthy();
    expect(screen.getByText("2026/11/01・月・昼・1,300円")).toBeTruthy();
    expect(screen.getByText(/直前のルール、存在しなければ未設定/)).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(mocks.remove).not.toHaveBeenCalled();

    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを削除" })),
    );
    mocks.remove.mockResolvedValue({
      serverError: {
        code: "HOURLY_WAGE_RULE_VERSION_CONFLICT",
        message: "競合しました。",
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        userId: "staff-1",
        hourlyWageRuleId: "nov-mon",
        expectedVersion: 1,
      }),
    );
    expect(await screen.findByText("競合しました。")).toBeTruthy();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("heading", { name: "時給ルールを削除" }),
    ).toBeNull();
  });

  test("削除成功後は最新履歴を取得し、ルールがなくなった日付groupを消す", async () => {
    mocks.hourlyWageRules.mockReset();
    mocks.hourlyWageRules
      .mockResolvedValueOnce({
        status: "ready",
        data: [{ ...baseHourlyWageRule, id: "only-rule", version: 7 }],
      })
      .mockResolvedValue({ status: "ready", data: [] });
    await renderHistory();
    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを削除" })),
    );
    let finish!: (result: { data?: unknown }) => void;
    mocks.remove.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const submit = screen.getByRole("button", { name: "削除する" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    expect(submit).toHaveProperty("disabled", true);
    finish({ data: undefined });
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        userId: "staff-1",
        hourlyWageRuleId: "only-rule",
        expectedVersion: 7,
      }),
    );
    expect(await screen.findByText("時給履歴はありません。")).toBeTruthy();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("heading", { name: "2026/04/01から" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "時給ルールを削除" }),
    ).toBeNull();
  });

  test("別管理者には訂正・削除操作を表示しない", async () => {
    users.data[0].role = "admin";
    mocks.currentUserId = "admin-2";
    await renderHistory();
    const userCard = await screen.findByRole("region", {
      name: "対象ユーザー",
    });
    expect(within(userCard).getByText("田中 太郎")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "時給ルールを訂正" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "時給ルールを削除" }),
    ).toBeNull();
  });

  test("管理者本人には操作を表示し、generic訂正エラーでは入力値とDialogを維持する", async () => {
    users.data[0].role = "admin";
    mocks.currentUserId = "staff-1";
    await renderHistory();
    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを訂正" })),
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "時給" }), {
      target: { value: "1350" },
    });
    mocks.update.mockResolvedValue({
      serverError: { code: "ACTION_FAILED", message: "一時エラー" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "訂正する" }));
    expect(await screen.findByText("一時エラー")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "時給" })).toHaveProperty(
      "value",
      "1350",
    );
    expect(
      screen.getByRole("heading", { name: "時給ルールを訂正" }),
    ).toBeTruthy();
  });

  test("削除のgeneric errorは確認Dialogを維持して再試行可能にする", async () => {
    await renderHistory();
    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを削除" })),
    );
    mocks.remove.mockResolvedValue({
      serverError: { code: "ACTION_FAILED", message: "削除できませんでした。" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(await screen.findByText("削除できませんでした。")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "時給ルールを削除" }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "削除する" }),
    ).toBeTruthy();
  });

  test("削除のpending中は二重送信とDialog closeを防ぐ", async () => {
    await renderHistory();
    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを削除" })),
    );
    let finish!: (result: { data?: unknown }) => void;
    mocks.remove.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const submit = screen.getByRole("button", { name: "削除する" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "削除中..." })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(
      screen.getByRole("heading", { name: "時給ルールを削除" }),
    ).toBeTruthy();
    finish({ data: undefined });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("heading", { name: "時給ルールを削除" }),
    ).toBeNull();
  });

  test("訂正のpending中は二重送信を防ぎ、SESSION_EXPIRED再認証後も編集dialogを維持する", async () => {
    await renderHistory();
    await fireEvent.click(
      first(await screen.findAllByRole("button", { name: "時給ルールを訂正" })),
    );
    let finish!: (result: {
      data?: unknown;
      serverError?: { code: string; message: string };
    }) => void;
    mocks.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const submit = screen.getByRole("button", { name: "訂正する" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByRole("combobox", { name: "勤務区分" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("combobox", { name: "日区分" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("spinbutton", { name: "時給" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("適用開始日")).toHaveProperty(
      "disabled",
      true,
    );
    finish({
      serverError: {
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      },
    });
    mocks.reauthenticate.mockResolvedValue(undefined);
    mocks.update.mockResolvedValueOnce({ data: undefined });
    await waitFor(() => expect(mocks.reauthenticate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("heading", { name: "時給ルールを訂正" }),
    ).toBeTruthy();
  });
});
