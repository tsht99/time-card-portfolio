import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AdminHourlyWageRulesState } from "../_lib/admin-hourly-wage-rules-types.ts";

const mocks = vi.hoisted(() => ({
  reauthenticate: vi.fn(async () => undefined),
  push: vi.fn(),
  refresh: vi.fn(),
  navigation: {
    url: "/admin/users/staff-1/hourly-wage-rules",
    listeners: new Set<() => void>(),
  },
  hourlyWageRules: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  bulk: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => mocks.refresh(),
    push: (url: string) => {
      mocks.push(url);
      mocks.navigation.url = url;
      for (const listener of mocks.navigation.listeners) listener();
    },
  }),
}));

vi.mock("../env", () => ({
  env: {
    NEXT_PUBLIC_LIFF_ID: "test-liff-id",
    NEXT_PUBLIC_HELP_URL: "https://help.example.test",
  },
}));
vi.mock("../../../../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: {
      status: "ready",
      user: {
        userId: "admin-1",
        displayName: "管理者",
        role: "admin",
        status: "active",
      },
    },
    reauthenticate: mocks.reauthenticate,
    isSubjectCurrent: true,
    canMutate: () => true,
  }),
}));
vi.mock("../../../../_actions/payroll-actions.ts", () => ({
  updateAdminHourlyWageRuleAction: mocks.update,
  deleteAdminHourlyWageRuleAction: mocks.remove,
  bulkUpdateAdminHourlyWageRulesAction: mocks.bulk,
  updateAdminUserAccessStatusAction: vi.fn(),
}));

const hourlyWageRule = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "staff-1",
  workPeriod: "day",
  dayType: "mon",
  hourlyWage: 1200,
  effectiveFrom: "2099-01-01",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

const staffUser = {
  userId: "staff-1",
  displayName: "対象スタッフ",
  role: "staff",
  status: "active",
} as const;
const adminUser = {
  userId: "admin-1",
  displayName: "ログイン中管理者",
  role: "admin",
  status: "active",
} as const;
const anotherAdminUser = {
  userId: "admin-2",
  displayName: "別管理者",
  role: "admin",
  status: "active",
} as const;

type TestUser = Omit<
  typeof staffUser,
  "userId" | "displayName" | "role" | "status"
> & {
  userId: string;
  displayName: string;
  role: "staff" | "admin";
  status: "active" | "inactive";
};

async function renderPage(
  users: TestUser[] = [staffUser],
  routeUserId = "staff-1",
  initialReferenceDate?: string,
) {
  const hourlyWageRulesState = await mocks.hourlyWageRules({
    userId: routeUserId,
  });
  const { HourlyWageRulesClient } = await import(
    "./hourly-wage-rules-client.tsx"
  );
  let setStateRef: ((state: typeof hourlyWageRulesState) => void) | undefined;
  mocks.refresh.mockImplementation(() => {
    void mocks
      .hourlyWageRules({ userId: routeUserId })
      .then((state: AdminHourlyWageRulesState) => setStateRef?.(state));
  });
  function HourlyWageRulesRouteHarness() {
    const [state, setState] = useState(hourlyWageRulesState);
    setStateRef = setState;
    const pathname = useSyncExternalStore(
      (listener) => {
        mocks.navigation.listeners.add(listener);
        return () => mocks.navigation.listeners.delete(listener);
      },
      () => mocks.navigation.url,
      () => mocks.navigation.url,
    );
    const selectedUserId =
      /^\/admin\/users\/([^/]+)\/hourly-wage-rules$/.exec(pathname)?.[1] ??
      "staff-1";
    return (
      <HourlyWageRulesClient
        key={selectedUserId}
        initialUsers={{ status: "ready", data: users }}
        selectedUserId={selectedUserId}
        initialReferenceDate={initialReferenceDate}
        hourlyWageRulesState={state}
      />
    );
  }
  mocks.navigation.url = `/admin/users/${routeUserId}/hourly-wage-rules`;
  mocks.navigation.listeners.clear();
  render(<HourlyWageRulesRouteHarness />);
}

async function selectOption(
  container: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  fireEvent.click(within(container).getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.hourlyWageRules.mockReset();
  mocks.update.mockReset();
  mocks.remove.mockReset();
  mocks.bulk.mockReset();
  mocks.reauthenticate.mockReset();
  mocks.reauthenticate.mockResolvedValue(undefined);
  mocks.hourlyWageRules.mockResolvedValue({
    status: "ready",
    data: [hourlyWageRule],
  });
  mocks.update.mockResolvedValue({ data: undefined });
  mocks.remove.mockResolvedValue({ data: undefined });
  mocks.bulk.mockResolvedValue({ data: undefined });
});

afterEach(cleanup);
afterEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

function setupUser() {
  return userEvent.setup({
    advanceTimers: (delay) =>
      vi.isFakeTimers() ? vi.advanceTimersByTime(delay) : Promise.resolve(),
  });
}

describe("時給ルール管理", () => {
  test("URLのuserIdから対象ユーザーを静的表示し、時給期間を切り替え、履歴URLもユーザー配下にする", async () => {
    await renderPage([staffUser]);

    expect(
      within(screen.getByRole("region", { name: "対象ユーザー" })).getByText(
        "対象スタッフ",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "対象ユーザー" })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "時給の適用期間" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(mocks.hourlyWageRules).toHaveBeenCalledWith({ userId: "staff-1" }),
    );
    expect(
      screen.getByRole("link", { name: "時給履歴" }).getAttribute("href"),
    ).toBe("/admin/users/staff-1/hourly-wage-rules/history");
  });

  test("確認基準日を初期選択し、その日以前の最新時給だけを表示する", async () => {
    mocks.hourlyWageRules.mockResolvedValue({
      status: "ready",
      data: [
        {
          ...hourlyWageRule,
          id: "old",
          hourlyWage: 1200,
          effectiveFrom: "2026-09-01",
        },
        {
          ...hourlyWageRule,
          id: "future",
          hourlyWage: 1500,
          effectiveFrom: "2026-09-21",
        },
      ],
    });
    await renderPage([staffUser], "staff-1", "2026-09-20");
    const period = screen.getByRole("combobox", { name: "時給の適用期間" });
    await waitFor(() => expect(period.textContent).toContain("2026/09/20時点"));
    const table = await screen.findByRole("table");
    expect(within(table).getByText("1,200円")).toBeTruthy();
    expect(within(table).queryByText("1,500円")).toBeNull();
    expect(
      screen.getByRole("link", { name: "時給履歴" }).getAttribute("href"),
    ).toBe("/admin/users/staff-1/hourly-wage-rules/history");
  });

  test("確認日と適用開始日が同じ場合は時点候補を一つだけ表示する", async () => {
    mocks.hourlyWageRules.mockResolvedValue({
      status: "ready",
      data: [{ ...hourlyWageRule, effectiveFrom: "2026-09-20" }],
    });
    await renderPage([staffUser], "staff-1", "2026-09-20");
    fireEvent.click(screen.getByRole("combobox", { name: "時給の適用期間" }));
    expect(
      await screen.findAllByRole("option", { name: "2026/09/20時点" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "2026/09/20から" })).toBeNull();
  });

  test("確認日にルールがなければ未設定を表示し、0円とは区別する", async () => {
    mocks.hourlyWageRules.mockResolvedValue({ status: "ready", data: [] });
    await renderPage([staffUser], "staff-1", "2026-09-20");
    const table = await screen.findByRole("table");
    const mondayRow = within(table).getByRole("row", { name: /月/ });
    expect(within(mondayRow).getAllByText("未設定")).toHaveLength(2);
    expect(within(mondayRow).queryByText("0円")).toBeNull();
  });

  test("deep linkから期間を手動で切り替えても取得済み時給だけを使う", async () => {
    mocks.hourlyWageRules.mockResolvedValue({
      status: "ready",
      data: [{ ...hourlyWageRule, effectiveFrom: "2026-09-01" }],
    });
    await renderPage([staffUser], "staff-1", "2026-09-20");
    await screen.findByRole("table");
    const user = setupUser();
    await selectOption(document.body, user, "時給の適用期間", "2026/09/01から");
    expect(mocks.hourlyWageRules).toHaveBeenCalledOnce();
    expect(
      within(
        screen.getByRole("combobox", { name: "時給の適用期間" }),
      ).getByText("2026/09/01から"),
    ).toBeTruthy();
  });

  test("確認基準日から編集すると同日を適用開始日にする", async () => {
    await renderPage([staffUser], "staff-1", "2026-09-20");
    await setupUser().click(screen.getByRole("button", { name: "時給を編集" }));
    expect(
      (screen.getByLabelText("適用開始日") as HTMLInputElement).value,
    ).toBe("2026-09-20");
  });

  test("時給一覧から編集モードを開き、空欄では保存できない", async () => {
    await renderPage([staffUser, anotherAdminUser]);
    expect(screen.getByRole("button", { name: "時給を編集" })).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "時給を編集" }));
    expect(
      screen
        .getAllByLabelText("適用開始日")
        .find((input) => input.getAttribute("aria-label") === "適用開始日")
        ?.getAttribute("type"),
    ).toBe("date");
    expect(screen.getAllByRole("spinbutton")).toHaveLength(16);
    expect(
      (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("link", { name: "時給履歴" })).toBeTruthy();
  });

  test("a valid cell and an invalid cell disable the entire bulk save", async () => {
    await renderPage();
    await setupUser().click(screen.getByRole("button", { name: "時給を編集" }));
    const validInput = screen.getByLabelText("月 昼の変更時給");
    const invalidInput = screen.getByLabelText("火 夜の変更時給");
    fireEvent.change(validInput, { target: { value: "1300" } });
    fireEvent.change(invalidInput, { target: { value: "1e3" } });
    expect(invalidInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("整数");
    expect(
      (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.bulk).not.toHaveBeenCalled();
    fireEvent.change(invalidInput, { target: { value: "100000" } });
    expect(invalidInput.getAttribute("aria-invalid")).toBe("true");
    expect(
      (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("date switches immediately with no draft and confirms discard when drafts exist", async () => {
    await renderPage();
    const user = setupUser();
    await user.click(screen.getByRole("button", { name: "時給を編集" }));
    const date = screen
      .getAllByLabelText("適用開始日")
      .find(
        (input) => input.getAttribute("aria-label") === "適用開始日",
      ) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-10-01" } });
    expect(date.value).toBe("2026-10-01");
    const draft = screen.getByLabelText("月 昼の変更時給") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "1400" } });
    fireEvent.change(date, { target: { value: "2026-10-02" } });
    expect(screen.getByRole("dialog").textContent).toContain(
      "入力内容を破棄しますか？",
    );
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(date.value).toBe("2026-10-01");
    expect(draft.value).toBe("1400");
    fireEvent.change(date, { target: { value: "2026-10-02" } });
    await user.click(screen.getByRole("button", { name: "破棄して変更" }));
    expect(date.value).toBe("2026-10-02");
    expect(draft.value).toBe("");
  });

  test("zero is valid, same-value and blank are omitted, and changes send in one bulk action", async () => {
    await renderPage();
    const user = setupUser();
    const section = screen.getByRole("region", { name: "時給一覧" });
    await selectOption(section, user, "時給の適用期間", "2099/01/01から");
    await user.click(screen.getByRole("button", { name: "時給を編集" }));
    const save = screen.getByRole("button", {
      name: "保存",
    }) as HTMLButtonElement;
    const same = screen.getByLabelText("月 昼の変更時給") as HTMLInputElement;
    fireEvent.change(same, { target: { value: "1200" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(same, { target: { value: "0" } });
    expect(save.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("火 夜の変更時給"), {
      target: { value: "1600" },
    });
    await user.click(save);
    await waitFor(() => expect(mocks.bulk).toHaveBeenCalledTimes(1));
    const payload = mocks.bulk.mock.calls[0]?.[0] as {
      changes: { hourlyWage: number }[];
    };
    expect(payload.changes).toHaveLength(2);
    expect(payload.changes.map((change) => change.hourlyWage)).toEqual([
      0, 1600,
    ]);
    await screen.findByText("時給を更新しました。");
  });

  test("bulk pending keeps the fixed target while disabling wage inputs and legacy CRUD stays absent", async () => {
    let resolveBulk: ((value: { data?: unknown }) => void) | undefined;
    mocks.bulk.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBulk = resolve;
        }),
    );
    await renderPage();
    const user = setupUser();
    await user.click(screen.getByRole("button", { name: "時給を編集" }));
    fireEvent.change(screen.getByLabelText("月 昼の変更時給"), {
      target: { value: "1300" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.bulk).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "保存中" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      within(screen.getByRole("region", { name: "対象ユーザー" })).getByText(
        "対象スタッフ",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "対象ユーザー" })).toBeNull();
    expect(
      (screen.getByLabelText("月 昼の変更時給") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.queryByText("新しい時給ルールを追加")).toBeNull();
    expect(screen.queryByText("すべてのルール・履歴")).toBeNull();
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
    resolveBulk?.({ data: undefined });
    await screen.findByText("時給を更新しました。");
  });

  test("bulk conflict clears drafts, refetches and keeps editor/date open", async () => {
    mocks.bulk.mockResolvedValueOnce({
      serverError: {
        code: "HOURLY_WAGE_RULE_BULK_CONFLICT",
        message: "対象の時給ルールは他の操作により変更されています。",
      },
    });
    await renderPage();
    const user = setupUser();
    await user.click(screen.getByRole("button", { name: "時給を編集" }));
    const date = screen
      .getAllByLabelText("適用開始日")
      .find(
        (input) => input.getAttribute("aria-label") === "適用開始日",
      ) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("月 昼の変更時給"), {
      target: { value: "1400" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      (
        await screen.findAllByText(
          "対象の時給ルールは他の操作により変更されています。",
        )
      ).length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).toBeTruthy(),
    );
    expect(date.value).toBe("2026-10-01");
    expect(
      (screen.getByLabelText("月 昼の変更時給") as HTMLInputElement).value,
    ).toBe("");
    expect(
      screen.getByRole("button", { name: "保存" }).hasAttribute("disabled"),
    ).toBe(true);
    await waitFor(() =>
      expect(mocks.hourlyWageRules.mock.calls.length).toBeGreaterThan(1),
    );
    expect(screen.queryByRole("button", { name: "時給を編集" })).toBeNull();
  });

  test("generic bulk error keeps entered draft for retry", async () => {
    mocks.bulk.mockResolvedValueOnce({
      serverError: {
        code: "TEMPORARY_FAILURE",
        message: "一時的なエラーです。",
      },
    });
    await renderPage();
    const user = setupUser();
    await user.click(screen.getByRole("button", { name: "時給を編集" }));
    const draft = screen.getByLabelText("月 昼の変更時給") as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "1400" } });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("一時的なエラーです。")).toBeTruthy();
    expect(draft.value).toBe("1400");
    expect(
      screen
        .getAllByLabelText("適用開始日")
        .some((input) => input.getAttribute("aria-label") === "適用開始日"),
    ).toBe(true);
  });

  test("選択ユーザーの履歴アイコンだけを正しい URL で表示する", async () => {
    await renderPage();
    const historyLink = screen.getByRole("link", { name: "時給履歴" });
    expect(historyLink.getAttribute("href")).toBe(
      "/admin/users/staff-1/hourly-wage-rules/history",
    );
    expect(historyLink.textContent).toBe("");
  });

  test("routeで指定したユーザーの履歴導線を表示する", async () => {
    await renderPage([staffUser]);
    expect(
      screen.getByRole("link", { name: "時給履歴" }).getAttribute("href"),
    ).toBe("/admin/users/staff-1/hourly-wage-rules/history");
  });

  test("固定の給与見込み一覧復帰リンクを表示しない", async () => {
    await renderPage();
    expect(
      screen.queryByRole("link", { name: "給与見込み一覧へ戻る" }),
    ).toBeNull();
  });

  test("期間を選択して曜日・昼夜マトリックスを表示する", async () => {
    mocks.hourlyWageRules.mockResolvedValue({
      status: "ready",
      data: [
        {
          ...hourlyWageRule,
          id: "old-mon-day",
          hourlyWage: 1000,
          effectiveFrom: "2026-01-01",
        },
        {
          ...hourlyWageRule,
          id: "old-mon-night",
          workPeriod: "night",
          hourlyWage: 900,
          effectiveFrom: "2026-01-01",
        },
        {
          ...hourlyWageRule,
          id: "same-mon-day",
          hourlyWage: 1200,
          effectiveFrom: "2026-08-01",
        },
        {
          ...hourlyWageRule,
          id: "future-mon-day",
          hourlyWage: 1400,
          effectiveFrom: "2026-09-01",
        },
        {
          ...hourlyWageRule,
          id: "mon-night",
          workPeriod: "night",
          hourlyWage: 0,
          effectiveFrom: "2026-08-01",
        },
        {
          ...hourlyWageRule,
          id: "holiday-day",
          dayType: "holiday",
          hourlyWage: 1500,
          effectiveFrom: "2026-08-01",
        },
        {
          ...hourlyWageRule,
          id: "future-tue-day",
          dayType: "tue",
          hourlyWage: 2000,
          effectiveFrom: "2026-09-01",
        },
      ],
    });
    await renderPage();
    const actionCallCount = mocks.hourlyWageRules.mock.calls.length;
    const user = setupUser();
    const periodSelect = screen.getByRole("combobox", {
      name: "時給の適用期間",
    });
    expect(periodSelect.textContent).toContain("現在の時給");
    await selectOption(document.body, user, "時給の適用期間", "2026/01/01から");
    const mondayBeforeChange = screen.getByRole("row", { name: /月/ });
    expect(within(mondayBeforeChange).getByText("1,000円")).toBeTruthy();
    expect(within(mondayBeforeChange).getByText("900円")).toBeTruthy();
    expect(
      within(screen.getByRole("row", { name: /火/ })).getAllByText("未設定"),
    ).toHaveLength(2);
    await selectOption(document.body, user, "時給の適用期間", "2026/08/01から");

    const table = await screen.findByRole("table");
    expect(table.querySelector("caption")?.textContent).toBe(
      "曜日別・昼夜別の時給",
    );
    expect(table.querySelectorAll('th[scope="col"]')).toHaveLength(3);
    expect(table.querySelectorAll('th[scope="row"]')).toHaveLength(8);
    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["日区分", "昼", "夜"]);
    expect(screen.getByRole("columnheader", { name: "日区分" })).toBeTruthy();
    expect(
      screen.getAllByRole("rowheader").map((header) => header.textContent),
    ).toEqual(["月", "火", "水", "木", "金", "土", "日", "祝日"]);

    const monday = screen.getByRole("row", { name: /月/ });
    expect(within(monday).getByText("1,200円")).toBeTruthy();
    expect(within(monday).queryByText("2026/08/01から")).toBeNull();
    expect(within(monday).getByText("0円")).toBeTruthy();
    const tuesday = screen.getByRole("row", { name: /火/ });
    expect(within(tuesday).getAllByText("未設定")).toHaveLength(2);
    expect(within(tuesday).queryByText("将来設定あり")).toBeNull();
    const holiday = screen.getByRole("row", { name: /祝日/ });
    expect(within(holiday).getByText("1,500円")).toBeTruthy();
    expect(within(holiday).getAllByText("未設定")).toHaveLength(1);
    expect(mocks.hourlyWageRules.mock.calls.length).toBe(actionCallCount);
  });

  test("期間候補は重複を除いて新しい順に並び、将来予定 badge を付けない", async () => {
    mocks.hourlyWageRules.mockResolvedValue({
      status: "ready",
      data: [
        { ...hourlyWageRule, id: "new-day", effectiveFrom: "2099-02-01" },
        {
          ...hourlyWageRule,
          id: "new-night",
          workPeriod: "night",
          effectiveFrom: "2099-02-01",
        },
        { ...hourlyWageRule, id: "old", effectiveFrom: "2026-08-01" },
      ],
    });
    await renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("combobox", { name: "時給の適用期間" }));
    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent?.trim());
    expect(options).toEqual(["現在の時給", "2099/02/01から", "2026/08/01から"]);
    expect(screen.queryByText("予定")).toBeNull();
  });

  test("現在の時給は固定した日本時間の当日を基準にする", async () => {
    mocks.hourlyWageRules.mockResolvedValue({
      status: "ready",
      data: [
        {
          ...hourlyWageRule,
          id: "before-today",
          hourlyWage: 1100,
          effectiveFrom: "2026-08-14",
        },
        {
          ...hourlyWageRule,
          id: "today",
          hourlyWage: 1200,
          effectiveFrom: "2026-08-15",
        },
        {
          ...hourlyWageRule,
          id: "after-today",
          hourlyWage: 1300,
          effectiveFrom: "2026-08-16",
        },
      ],
    });
    await renderPage();
    const user = userEvent.setup();
    await selectOption(document.body, user, "時給の適用期間", "2026/08/14から");
    expect(within(screen.getByRole("table")).getByText("1,100円")).toBeTruthy();
    const RealDate = Date;
    vi.stubGlobal(
      "Date",
      class FixedDate extends RealDate {
        constructor(value?: string | number | Date) {
          super(
            value === undefined
              ? "2026-08-14T16:00:00.000Z"
              : value instanceof RealDate
                ? value.getTime()
                : value,
          );
        }

        static now() {
          return new RealDate("2026-08-14T16:00:00.000Z").getTime();
        }
      },
    );
    await selectOption(document.body, user, "時給の適用期間", "現在の時給");
    expect(within(screen.getByRole("table")).getByText("1,200円")).toBeTruthy();
  });

  test("期間候補には選択対象ユーザーの日付だけを含める", async () => {
    mocks.hourlyWageRules.mockResolvedValue({
      status: "ready",
      data: [
        { ...hourlyWageRule, effectiveFrom: "2026-08-01" },
        {
          ...hourlyWageRule,
          id: "other-user",
          userId: "staff-2",
          effectiveFrom: "2099-01-01",
        },
      ],
    });
    await renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("combobox", { name: "時給の適用期間" }));
    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent?.trim());
    expect(options).toEqual(["現在の時給", "2026/08/01から"]);
  });

  test("正常な0件取得では16セルを未設定として表示する", async () => {
    mocks.hourlyWageRules.mockResolvedValue({ status: "ready", data: [] });
    await renderPage();

    const table = await screen.findByRole("table");
    const cells = within(table).getAllByRole("cell");
    expect(cells).toHaveLength(16);
    expect(cells.every((cell) => cell.textContent?.includes("未設定"))).toBe(
      true,
    );
  });

  test("Server Componentから受け取った時給で初期表示し、client loading状態を挟まない", async () => {
    await renderPage();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByText("時給一覧を読み込み中")).toBeNull();
  });

  test("URLで指定した別ユーザーだけの時給を表示する", async () => {
    const anotherUser = {
      ...staffUser,
      userId: "staff-2",
      displayName: "別スタッフ",
    } as const;
    mocks.hourlyWageRules.mockImplementation(
      async ({ userId }: { userId: string }) => ({
        status: "ready",
        data: [
          {
            ...hourlyWageRule,
            userId,
            hourlyWage: userId === "staff-1" ? 1200 : 1800,
            effectiveFrom: "2026-01-01",
          },
        ],
      }),
    );
    await renderPage([staffUser, anotherUser], "staff-2");
    expect(
      within(await screen.findByRole("table")).getByText("1,800円"),
    ).toBeTruthy();
    expect(screen.queryByText("1,200円")).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "対象ユーザー" })).getByText(
        "別スタッフ",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "対象ユーザー" })).toBeNull();
  });

  test("別の管理者は時給を閲覧できるが変更操作を表示しない", async () => {
    mocks.hourlyWageRules.mockImplementation(
      async ({ userId }: { userId: string }) => ({
        status: "ready",
        data: [{ ...hourlyWageRule, userId, hourlyWage: 1800 }],
      }),
    );
    await renderPage([staffUser, adminUser, anotherAdminUser], "admin-2");
    const user = setupUser();
    await selectOption(document.body, user, "時給の適用期間", "2099/01/01から");
    expect(await screen.findByText("1,800円")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "時給を編集" })).toBeNull();
    expect(screen.queryByText("新しい時給ルールを追加")).toBeNull();
    expect(screen.queryByText("すべてのルール・履歴")).toBeNull();
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
    expect(mocks.hourlyWageRules).toHaveBeenCalledWith({ userId: "admin-2" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  test("inactive な別の管理者も閲覧できるが変更操作を表示しない", async () => {
    mocks.hourlyWageRules.mockImplementation(
      async ({ userId }: { userId: string }) => ({
        status: "ready",
        data: [{ ...hourlyWageRule, userId }],
      }),
    );
    await renderPage(
      [staffUser, { ...anotherAdminUser, status: "inactive" }],
      "admin-2",
    );
    const user = setupUser();
    await selectOption(document.body, user, "時給の適用期間", "2099/01/01から");
    expect(await screen.findByText("1,200円")).toBeTruthy();
    expect(screen.queryByText("新しい時給ルールを追加")).toBeNull();
    expect(screen.queryByText("すべてのルール・履歴")).toBeNull();
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
  });

  test("管理者本人も一括編集で1セルだけを保存できる", async () => {
    mocks.hourlyWageRules.mockImplementation(
      async ({ userId }: { userId: string }) => ({
        status: "ready",
        data: [{ ...hourlyWageRule, userId }],
      }),
    );
    await renderPage([staffUser, adminUser, anotherAdminUser], "admin-1");
    const user = setupUser();
    await user.click(screen.getByRole("button", { name: "時給を編集" }));
    fireEvent.change(screen.getByLabelText("適用開始日"), {
      target: { value: "2026-09-26" },
    });
    fireEvent.change(screen.getByLabelText("月 昼の変更時給"), {
      target: { value: "1500" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.bulk).toHaveBeenCalledTimes(1));
    expect(mocks.bulk).toHaveBeenCalledWith({
      userId: "admin-1",
      effectiveFrom: "2026-09-26",
      changes: [
        {
          dayType: "mon",
          workPeriod: "day",
          hourlyWage: 1500,
          expectedBaseline: null,
        },
      ],
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  test("時給設定画面から旧個別CRUDを除き、履歴と一括編集を残す", async () => {
    await renderPage();
    expect(screen.queryByText("新しい時給ルールを追加")).toBeNull();
    expect(screen.queryByText("すべてのルール・履歴")).toBeNull();
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
    expect(screen.queryByRole("button", { name: "削除" })).toBeNull();
    expect(screen.getByRole("link", { name: "時給履歴" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "時給を編集" })).toBeTruthy();
    await setupUser().click(screen.getByRole("button", { name: "時給を編集" }));
    expect(screen.getAllByLabelText(/変更時給$/)).toHaveLength(16);
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
  });

  test("missing session stateはServer Componentのpropsで表示し、client再認証をしない", async () => {
    mocks.hourlyWageRules
      .mockResolvedValueOnce({
        status: "missing",
        message: "ログインが必要です。",
      })
      .mockResolvedValueOnce({ status: "ready", data: [] });
    await renderPage();
    expect(await screen.findByText("ログインが必要です。")).toBeTruthy();
    expect(mocks.hourlyWageRules).toHaveBeenCalledTimes(1);
    expect(mocks.reauthenticate).not.toHaveBeenCalled();
  });
});
