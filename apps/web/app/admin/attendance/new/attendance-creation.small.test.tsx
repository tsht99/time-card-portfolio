import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AdminUsersState } from "../../../../lib/admin-user-management-types";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  reauthenticate: vi.fn(async () => undefined),
  create: vi.fn(),
  authState: {
    status: "ready" as "ready" | "checking" | "error" | "unavailable",
    message: "",
    user: { userId: "admin-1", role: "admin" },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("../../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: mocks.authState,
    reauthenticate: mocks.reauthenticate,
  }),
}));
vi.mock("../../_actions/attendance-actions.ts", () => ({
  createAdminAttendanceAction: mocks.create,
}));

const users = [
  {
    userId: "admin-1",
    displayName: "現在の管理者",
    role: "admin" as const,
    status: "active" as const,
  },
  {
    userId: "admin-2",
    displayName: "別管理者",
    role: "admin" as const,
    status: "active" as const,
  },
  {
    userId: "admin-3",
    displayName: "無効な別管理者",
    role: "admin" as const,
    status: "inactive" as const,
  },
  {
    userId: "admin-4",
    displayName: "承認待ち管理者",
    role: "admin" as const,
    status: "pending" as const,
  },
  {
    userId: "staff-1",
    displayName: "有効スタッフ",
    role: "staff" as const,
    status: "active" as const,
  },
  {
    userId: "staff-2",
    displayName: null,
    role: "staff" as const,
    status: "inactive" as const,
  },
  {
    userId: "staff-3",
    displayName: "承認待ちスタッフ",
    role: "staff" as const,
    status: "pending" as const,
  },
];

const navigation = {
  canonicalQuery:
    "from=2026-09-01&to=2026-09-30&userId=staff-1&workPeriod=night&status=working",
};

async function renderForm(
  initialUsers: AdminUsersState = { status: "ready", data: users },
) {
  const { AttendanceCreation } = await import("./attendance-creation");
  const { QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renderElement = () => (
    <QueryClientProvider client={queryClient}>
      <AttendanceCreation initialUsers={initialUsers} {...navigation} />
    </QueryClientProvider>
  );
  const rendered = render(renderElement());
  return {
    ...rendered,
    rerenderWithAuthState: () => rendered.rerender(renderElement()),
  };
}

function creationForm() {
  const form = screen.getByRole("form", { name: "勤怠新規作成フォーム" });
  return within(form);
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  candidateName = "名前未設定",
  workPeriod: "day" | "night" = "night",
) {
  const form = creationForm();
  fireEvent.click(form.getByRole("combobox", { name: "作成対象者" }));
  await user.click(screen.getByRole("option", { name: candidateName }));
  expect(
    form.getByRole("combobox", { name: "作成対象者" }).textContent,
  ).toContain(candidateName);
  await user.click(
    form.getByRole("radio", { name: workPeriod === "day" ? "昼" : "夜" }),
  );
  expect(
    form.getByRole("radio", { name: workPeriod === "day" ? "昼" : "夜" }),
  ).toHaveProperty("checked", true);
  fireEvent.change(form.getByLabelText("作成出勤日時"), {
    target: { value: "2026-09-01T18:00" },
  });
  fireEvent.change(form.getByLabelText("作成退勤日時"), {
    target: { value: "2026-09-01T23:00" },
  });
  return form;
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.reauthenticate.mockReset();
  mocks.create.mockReset();
  mocks.create.mockResolvedValue({ success: true, attendanceId: "new-1" });
  mocks.reauthenticate.mockResolvedValue(undefined);
  mocks.authState.status = "ready";
  mocks.authState.message = "";
  mocks.authState.user = { userId: "admin-1", role: "admin" };
});
afterEach(() => cleanup());

describe("AttendanceCreation", () => {
  test("勤務区分は初期未選択で、マウスとキーボードで単一選択できる", async () => {
    const user = userEvent.setup();
    await renderForm();
    const form = creationForm();
    const day = form.getByRole("radio", { name: "昼" });
    const night = form.getByRole("radio", { name: "夜" });
    expect(day).toHaveProperty("checked", false);
    expect(night).toHaveProperty("checked", false);
    expect(day).toBeTruthy();

    await user.click(day);
    expect(day).toHaveProperty("checked", true);
    expect(night).toHaveProperty("checked", false);
    await user.click(day);
    expect(day).toHaveProperty("checked", true);
    await user.click(night);
    expect(day).toHaveProperty("checked", false);
    expect(night).toHaveProperty("checked", true);
    expect(night).toBeTruthy();

    day.focus();
    await user.keyboard(" ");
    expect(day).toHaveProperty("checked", true);
    expect(night).toHaveProperty("checked", false);
  });

  test("active / inactiveのstaffと管理者本人だけを候補にし、JST日時とcanonical detail URLで送信する", async () => {
    const user = userEvent.setup();
    await renderForm();
    const form = await fillValidForm(user);
    await user.click(form.getByRole("button", { name: "作成" }));

    fireEvent.click(form.getByRole("combobox", { name: "作成対象者" }));
    expect(screen.getByRole("option", { name: "現在の管理者" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "別管理者" })).toBeNull();
    expect(screen.queryByRole("option", { name: "無効な別管理者" })).toBeNull();
    expect(screen.getByRole("option", { name: "有効スタッフ" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "名前未設定" })).toBeTruthy();
    expect(
      screen.queryByRole("option", { name: "承認待ちスタッフ" }),
    ).toBeNull();
    expect(screen.queryByRole("option", { name: "承認待ち管理者" })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        userId: "staff-2",
        workPeriod: "night",
        clockInAt: "2026-09-01T18:00:00+09:00",
        clockOutAt: "2026-09-01T23:00:00+09:00",
      }),
    );
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/admin/attendance/new-1?from=2026-09-01&to=2026-09-30&userId=staff-1&workPeriod=night&status=working",
      ),
    );
  });

  test.each(["day", "night"] as const)(
    "%sの選択値をpayloadで送信する",
    async (workPeriod) => {
      const user = userEvent.setup();
      await renderForm();
      const form = await fillValidForm(user, "有効スタッフ", workPeriod);
      await user.click(form.getByRole("button", { name: "作成" }));
      await waitFor(() =>
        expect(mocks.create).toHaveBeenCalledWith(
          expect.objectContaining({ userId: "staff-1", workPeriod }),
        ),
      );
    },
  );

  test("不正な時系列ではActionを呼ばない", async () => {
    const user = userEvent.setup();
    await renderForm();
    const form = creationForm();
    fireEvent.click(form.getByRole("combobox", { name: "作成対象者" }));
    await user.click(screen.getByRole("option", { name: "有効スタッフ" }));
    fireEvent.change(form.getByLabelText("作成出勤日時"), {
      target: { value: "2026-09-01T18:00" },
    });
    fireEvent.change(form.getByLabelText("作成退勤日時"), {
      target: { value: "2026-09-01T18:00" },
    });
    await user.click(form.getByRole("button", { name: "作成" }));
    expect(
      await screen.findByText("退勤日時は出勤日時より後にしてください。"),
    ).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("必須項目とcontract field errorではActionを呼ばない", async () => {
    const user = userEvent.setup();
    await renderForm();
    const form = creationForm();
    await user.click(form.getByRole("button", { name: "作成" }));
    expect(await form.findByText("勤務区分を選択してください。")).toBeTruthy();
    expect(await form.findByText("対象者を選択してください。")).toBeTruthy();
    expect(
      form
        .getByRole("combobox", { name: "作成対象者" })
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      form
        .getByRole("combobox", { name: "作成対象者" })
        .getAttribute("aria-describedby"),
    ).toBe("creation-user-id-error");
    expect(await form.findByText("出勤日時を入力してください。")).toBeTruthy();
    expect(await form.findByText("退勤日時を入力してください。")).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();

    fireEvent.click(form.getByRole("combobox", { name: "作成対象者" }));
    await user.click(screen.getByRole("option", { name: "有効スタッフ" }));
    fireEvent.change(form.getByLabelText("作成退勤日時"), {
      target: { value: "2026-09-01T23:00" },
    });
    const clockIn = form.getByLabelText("作成出勤日時");
    clockIn.setAttribute("type", "text");
    fireEvent.change(clockIn, { target: { value: "2026-13-01T18:00" } });
    await user.click(form.getByRole("button", { name: "作成" }));
    expect(await screen.findByText("Invalid ISO datetime")).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("候補なしではメッセージを表示しsubmitをdisabledにする", async () => {
    await renderForm({ status: "ready", data: [users[1], users[2]] });
    expect(screen.getByText("新規作成できる対象者がいません。")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "作成" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test.each([["現在の管理者", "admin-1"]])(
    "%sはスタッフと同じpayloadで送信する",
    async (candidateName, userId) => {
      const user = userEvent.setup();
      await renderForm();
      const form = await fillValidForm(user, candidateName);
      await user.click(form.getByRole("button", { name: "作成" }));
      await waitFor(() =>
        expect(mocks.create).toHaveBeenCalledWith({
          userId,
          workPeriod: "night",
          clockInAt: "2026-09-01T18:00:00+09:00",
          clockOutAt: "2026-09-01T23:00:00+09:00",
        }),
      );
    },
  );

  test("認証済みユーザーが変わると管理者本人の候補に切り替わる", async () => {
    const view = await renderForm();
    const form = creationForm();
    fireEvent.click(form.getByRole("combobox", { name: "作成対象者" }));
    expect(screen.getByRole("option", { name: "現在の管理者" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "別管理者" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("option", { name: "対象者を選択" }), {
      key: "Escape",
      code: "Escape",
    });

    mocks.authState.user = { userId: "admin-2", role: "admin" };
    view.rerenderWithAuthState();

    fireEvent.click(form.getByRole("combobox", { name: "作成対象者" }));
    expect(screen.queryByRole("option", { name: "現在の管理者" })).toBeNull();
    expect(screen.getByRole("option", { name: "別管理者" })).toBeTruthy();
  });

  test("候補から外れた古い選択値ではActionを呼ばない", async () => {
    const user = userEvent.setup();
    const view = await renderForm();
    const form = creationForm();
    fireEvent.click(form.getByRole("combobox", { name: "作成対象者" }));
    await user.click(screen.getByRole("option", { name: "現在の管理者" }));
    await user.click(form.getByRole("radio", { name: "夜" }));
    fireEvent.change(form.getByLabelText("作成出勤日時"), {
      target: { value: "2026-09-01T18:00" },
    });
    fireEvent.change(form.getByLabelText("作成退勤日時"), {
      target: { value: "2026-09-01T23:00" },
    });

    mocks.authState.user = { userId: "admin-2", role: "admin" };
    view.rerenderWithAuthState();
    await user.click(form.getByRole("button", { name: "作成" }));

    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("ユーザー取得失敗時は文脈を表示し作成操作をdisabledにする", async () => {
    await renderForm({
      status: "error",
      message: "ユーザー取得失敗",
    });
    expect(screen.getByText(/対象者候補を取得できないため/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("ユーザー取得失敗");
    expect(screen.getByRole("combobox", { name: "作成対象者" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      (screen.getByRole("button", { name: "作成" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  test("Action errorを表示し入力値を保持する", async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({
      success: false,
      code: "ATTENDANCE_TIME_OVERLAP",
      message: "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
    });
    await renderForm();
    const form = await fillValidForm(user);
    await user.click(form.getByRole("button", { name: "作成" }));
    expect(
      await screen.findByText(
        "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
      ),
    ).toBeTruthy();
    expect(
      (form.getByLabelText("作成出勤日時") as HTMLInputElement).value,
    ).toBe("2026-09-01T18:00");
    expect(
      (form.getByLabelText("作成退勤日時") as HTMLInputElement).value,
    ).toBe("2026-09-01T23:00");
  });

  test("invalid submitでは以前のAction errorを消す", async () => {
    const user = userEvent.setup();
    mocks.create.mockResolvedValue({
      success: false,
      code: "ATTENDANCE_TIME_OVERLAP",
      message: "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
    });
    await renderForm();
    const form = await fillValidForm(user);
    await user.click(form.getByRole("button", { name: "作成" }));
    await screen.findByText(
      "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
    );
    fireEvent.click(form.getByRole("combobox", { name: "作成対象者" }));
    await user.click(screen.getByRole("option", { name: "対象者を選択" }));
    await user.click(form.getByRole("button", { name: "作成" }));
    expect(await form.findByText("対象者を選択してください。")).toBeTruthy();
    expect(
      screen.queryByText(
        "既存の勤怠と勤務時間が重複しています。時刻を確認してください。",
      ),
    ).toBeNull();
  });

  test("SESSION_EXPIREDは再認証後に一度だけretryする", async () => {
    const user = userEvent.setup();
    mocks.create
      .mockResolvedValueOnce({
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      })
      .mockResolvedValueOnce({ success: true, attendanceId: "new-1" });
    await renderForm();
    const form = await fillValidForm(user);
    await user.click(form.getByRole("button", { name: "作成" }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(2);
      expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
      expect(mocks.replace).toHaveBeenCalledTimes(1);
    });
  });

  test("pending中は重複送信できず作成中表示になる", async () => {
    const user = userEvent.setup();
    let resolveCreate: ((value: unknown) => void) | undefined;
    mocks.create.mockImplementationOnce(
      () => new Promise((resolve) => (resolveCreate = resolve)),
    );
    await renderForm();
    const form = await fillValidForm(user);
    await user.click(form.getByRole("button", { name: "作成" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(form.getByRole("button", { name: "作成中" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(form.getByRole("button", { name: "作成中" }));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    resolveCreate?.({ success: true, attendanceId: "new-1" });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledTimes(1));
  });

  test.each([
    ["checking", "認証を確認しています"],
    ["error", "認証に失敗しました"],
    ["unavailable", "管理画面を利用できません"],
  ] as const)(
    "auth state %sでは通常フォームを表示しない",
    async (status, message) => {
      mocks.authState.status = status;
      mocks.authState.message = message;
      await renderForm();
      expect(screen.getByText(message)).toBeTruthy();
      expect(
        screen.queryByRole("form", { name: "勤怠新規作成フォーム" }),
      ).toBeNull();
    },
  );

  test("固定の一覧復帰リンクを表示しない", async () => {
    await renderForm();
    expect(screen.queryByRole("link", { name: "勤怠一覧へ戻る" })).toBeNull();
  });
});
