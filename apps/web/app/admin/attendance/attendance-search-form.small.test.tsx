import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AttendanceFilters } from "../../../lib/admin-attendance-filters";
import type { AdminUsersState } from "../../../lib/admin-user-management-types";
import { AttendanceSearchForm } from "./attendance-search-form";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

const initialFilters: AttendanceFilters = {
  startAttendanceDateInclusive: "2026-08-01",
  endAttendanceDateInclusive: "2026-08-31",
  userId: "staff-1",
  workPeriod: "night" as const,
  status: "working" as const,
};
const readyUsers: AdminUsersState = {
  status: "ready" as const,
  data: [
    {
      userId: "staff-1",
      displayName: "スタッフ",
      role: "staff" as const,
      status: "active" as const,
    },
  ],
};

function renderForm(
  appliedFilters = initialFilters,
  initialUsers = readyUsers,
) {
  return render(
    <AttendanceSearchForm
      appliedFilters={appliedFilters}
      initialUsers={initialUsers}
    />,
  );
}

function openForm() {
  return screen.getByRole("button", { name: /検索条件を開く/ });
}

function visibleSummary() {
  return screen.getByTestId("applied-filter-summary");
}

afterEach(() => {
  cleanup();
  mocks.push.mockReset();
});

describe("AttendanceSearchForm", () => {
  test("初期状態は閉じており、期間と適用条件を表示する", () => {
    renderForm();
    const card = openForm();
    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(visibleSummary().textContent).toContain("8/1 ～ 8/31");
    expect(visibleSummary().textContent).toContain("スタッフ");
    expect(visibleSummary().textContent).toContain("夜");
    expect(visibleSummary().textContent).toContain("勤務中");
    expect(visibleSummary().textContent).not.toContain("2026");
    expect(visibleSummary().textContent).not.toContain("利用者：");
    expect(visibleSummary().textContent).not.toContain("勤務区分：");
    expect(visibleSummary().textContent).not.toContain("状態：");
    expect(
      document.getElementById(card.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toContain(
      "期間：2026/08/01 ～ 2026/08/31。利用者：スタッフ。勤務区分：夜。状態：勤務中",
    );
    expect(screen.queryByLabelText("開始日")).toBeNull();
  });

  test("検索条件の展開状態をアクセシブルな属性で示す", async () => {
    const user = userEvent.setup();
    renderForm();
    const toggle = openForm();
    const panelId = toggle.getAttribute("aria-controls");

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panelId).toBeTruthy();

    const panel = panelId ? document.getElementById(panelId) : null;
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute("hidden")).toBe(true);

    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.hasAttribute("hidden")).toBe(false);
  });

  test("未指定条件は可視サマリから省き、指定条件だけをチップに表示する", () => {
    renderForm({
      ...initialFilters,
      startAttendanceDateInclusive: "2026-09-01",
      endAttendanceDateInclusive: "2026-09-07",
      userId: "",
      workPeriod: "",
      status: "",
    });
    expect(visibleSummary().textContent).toBe("9/1 ～ 9/7");
    const toggle = openForm();
    expect(
      document.getElementById(toggle.getAttribute("aria-describedby") ?? "")
        ?.textContent,
    ).toContain("利用者：全員。勤務区分：すべて。状態：すべて");
    cleanup();
    renderForm();
    expect(within(visibleSummary()).getByText("スタッフ")).toBeTruthy();
    expect(within(visibleSummary()).getByText("夜")).toBeTruthy();
    expect(within(visibleSummary()).getByText("勤務中")).toBeTruthy();
  });

  test("利用者名を取得できない指定値はIDで表示する", () => {
    renderForm(initialFilters, {
      status: "error",
      code: "USER_NOT_FOUND",
      message: "取得失敗",
    });
    expect(visibleSummary().textContent).toContain("ID: staff-1");
  });

  test("展開後も適用値を表示し、フォームの変更は適用条件を変えない", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(openForm());
    expect(visibleSummary().textContent).toContain("夜");
    const workPeriod = screen.getByRole("group", { name: "勤務区分" });
    const night = within(workPeriod).getByRole("radio", { name: "夜" });
    const day = within(workPeriod).getByRole("radio", { name: "昼" });
    expect((night as HTMLInputElement).checked).toBe(true);
    await user.click(day);
    expect((day as HTMLInputElement).checked).toBe(true);
    expect((night as HTMLInputElement).checked).toBe(false);
    expect(visibleSummary().textContent).toContain("夜");
  });

  test("キャンセルと上部からの折りたたみはdraftを破棄し、再展開時に適用値から再開する", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(openForm());
    await user.click(
      within(screen.getByRole("group", { name: "勤務区分" })).getByRole(
        "radio",
        { name: "昼" },
      ),
    );
    fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-08-10" },
    });
    screen.getByRole("button", { name: "キャンセル" }).focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(openForm());
    await user.click(openForm());
    expect((screen.getByLabelText("開始日") as HTMLInputElement).value).toBe(
      "2026-08-01",
    );
    const restoredNight = within(
      screen.getByRole("group", { name: "勤務区分" }),
    ).getByRole("radio", { name: "夜" });
    expect((restoredNight as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-08-10" },
    });
    await user.click(
      within(screen.getByRole("group", { name: "勤務区分" })).getByRole(
        "radio",
        { name: "昼" },
      ),
    );
    await user.click(screen.getByRole("button", { name: /検索条件を閉じる/ }));
    expect(document.activeElement).toBe(openForm());
    await user.click(openForm());
    expect((screen.getByLabelText("開始日") as HTMLInputElement).value).toBe(
      "2026-08-01",
    );
  });

  test("初期条件に戻しても即時適用せず、検索で適用し、キャンセルなら元に戻す", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T03:00:00.000Z"));
    try {
      renderForm();
      fireEvent.click(openForm());
      fireEvent.click(screen.getByRole("button", { name: "初期条件に戻す" }));
      expect((screen.getByLabelText("開始日") as HTMLInputElement).value).toBe(
        "2026-09-22",
      );
      expect((screen.getByLabelText("終了日") as HTMLInputElement).value).toBe(
        "2026-09-28",
      );
      expect(screen.getByRole("radio", { name: "すべて" })).toBeTruthy();
      expect(screen.getByRole("combobox", { name: "利用者" })).toBeTruthy();
      expect(screen.getByRole("combobox", { name: "状態" })).toBeTruthy();
      expect(mocks.push).not.toHaveBeenCalled();
      expect(visibleSummary().textContent).toContain("8/1 ～ 8/31");
      fireEvent.click(screen.getByRole("button", { name: "検索" }));
      expect(mocks.push).toHaveBeenCalledWith(
        "/admin/attendance?from=2026-09-22&to=2026-09-28",
      );
      expect(screen.queryByLabelText("開始日")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("初期条件に戻した後のキャンセルでも適用済み条件へ戻す", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T03:00:00.000Z"));
    try {
      renderForm();
      fireEvent.click(openForm());
      fireEvent.click(screen.getByRole("button", { name: "初期条件に戻す" }));
      fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
      fireEvent.click(openForm());
      expect((screen.getByLabelText("開始日") as HTMLInputElement).value).toBe(
        "2026-08-01",
      );
      expect((screen.getByLabelText("終了日") as HTMLInputElement).value).toBe(
        "2026-08-31",
      );
      expect(mocks.push).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test("キーボード操作で開閉でき、閉じたフォームはfocus対象にならない", async () => {
    const user = userEvent.setup();
    renderForm();
    const card = openForm();
    card.focus();
    await user.keyboard("{Enter}");
    expect(card.getAttribute("aria-expanded")).toBe("true");
    expect(card.getAttribute("aria-controls")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(card.getAttribute("aria-expanded")).toBe("true");
    await user.click(card);
    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("開始日")).toBeNull();
    expect(screen.queryByRole("radio", { name: "すべて" })).toBeNull();
  });

  test("未指定の勤務区分はすべてだけが選択され、キーボードで変更できる", async () => {
    const user = userEvent.setup();
    renderForm({ ...initialFilters, workPeriod: "" });
    await user.click(openForm());
    const workPeriod = screen.getByRole("group", { name: "勤務区分" });
    const all = within(workPeriod).getByRole("radio", { name: "すべて" });
    const day = within(workPeriod).getByRole("radio", { name: "昼" });
    const night = within(workPeriod).getByRole("radio", { name: "夜" });
    expect((all as HTMLInputElement).checked).toBe(true);
    expect((day as HTMLInputElement).checked).toBe(false);
    expect((night as HTMLInputElement).checked).toBe(false);
    all.focus();
    await user.keyboard("{ArrowRight}");
    expect((day as HTMLInputElement).checked).toBe(true);
    expect((all as HTMLInputElement).checked).toBe(false);
    expect((night as HTMLInputElement).checked).toBe(false);
  });

  test("勤務区分の選択状態をradioのcheckedで示す", async () => {
    const user = userEvent.setup();
    renderForm({ ...initialFilters, workPeriod: "" });
    await user.click(openForm());
    const workPeriod = screen.getByRole("group", { name: "勤務区分" });
    for (const name of ["すべて", "昼", "夜"]) {
      const radio = within(workPeriod).getByRole("radio", { name });
      await user.click(radio);
      expect((radio as HTMLInputElement).checked).toBe(true);
    }
  });

  test("有効な条件を既存形式のURLで検索し、同一条件では遷移しない", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(openForm());
    await user.click(
      within(screen.getByRole("group", { name: "勤務区分" })).getByRole(
        "radio",
        { name: "昼" },
      ),
    );
    expect(mocks.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "検索" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/admin/attendance?from=2026-08-01&to=2026-08-31&userId=staff-1&workPeriod=day&status=working",
    );
    expect(screen.queryByLabelText("開始日")).toBeNull();

    mocks.push.mockReset();
    await user.click(openForm());
    screen.getByRole("button", { name: "検索" }).focus();
    await user.keyboard("{Enter}");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(openForm());
  });

  test("すべてで検索するとworkPeriodをURLから省略する", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(openForm());
    await user.click(
      within(screen.getByRole("group", { name: "勤務区分" })).getByRole(
        "radio",
        { name: "すべて" },
      ),
    );
    await user.click(screen.getByRole("button", { name: "検索" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/admin/attendance?from=2026-08-01&to=2026-08-31&userId=staff-1&status=working",
    );
  });

  test("不正な日付範囲では検索せず、既存のエラー属性を維持する", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(openForm());
    fireEvent.change(screen.getByLabelText("開始日"), {
      target: { value: "2026-09-01" },
    });
    expect(
      screen.getByText("開始日は終了日以前の日付を指定してください。"),
    ).toBeTruthy();
    expect(screen.getByLabelText("開始日").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(
      screen.getByLabelText("終了日").getAttribute("aria-describedby"),
    ).toBe("attendance-search-range-error");
    expect(
      (screen.getByRole("button", { name: "検索" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
