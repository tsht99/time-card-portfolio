import type { AdminAttendanceDetail } from "@repo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import type { AdminUsersState } from "../../../../../lib/admin-user-management-types";
import { AttendanceCorrection } from "./attendance-correction";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  reauthenticate: vi.fn(async () => undefined),
  correct: vi.fn(),
  authState: {
    status: "ready" as const,
    user: { userId: "admin-1" },
  },
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("../../../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: mocks.authState,
    reauthenticate: mocks.reauthenticate,
  }),
}));
vi.mock("../../../_actions/attendance-actions.ts", () => ({
  correctAdminAttendanceAction: mocks.correct,
}));

const working: AdminAttendanceDetail = {
  attendanceId: "attendance-1",
  eventVersion: 2,
  attendanceDate: "2026-09-03",
  userId: "staff-1",
  displayName: "有効スタッフ",
  workPeriod: "day",
  clockInAt: "2026-09-03T09:15:00.000Z",
  clockOutAt: null,
  workedMinutes: null,
  status: "working",
  payroll: {
    hourlyWage: null,
    estimatedPayYen: null,
    status: "missingHourlyWage",
  },
  history: [],
};
const completed: AdminAttendanceDetail = {
  ...working,
  clockOutAt: "2026-09-03T18:00:00.000Z",
  workedMinutes: 525,
  status: "completed",
};
const cancelled: AdminAttendanceDetail = {
  ...completed,
  status: "cancelled",
};

const initialUsers: AdminUsersState = {
  status: "ready",
  data: [
    {
      userId: "admin-1",
      displayName: "管理者",
      role: "admin",
      status: "active",
    },
    {
      userId: "admin-2",
      displayName: "別管理者",
      role: "admin",
      status: "active",
    },
    {
      userId: "staff-1",
      displayName: "有効スタッフ",
      role: "staff",
      status: "active",
    },
  ],
};

function renderCorrection(
  detail: AdminAttendanceDetail,
  users: AdminUsersState = initialUsers,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AttendanceCorrection
        initialDetail={{ status: "ready", data: detail }}
        initialUsers={users}
        detailHref="/admin/attendance/attendance-1?from=2026-09-01&to=2026-09-30"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.reauthenticate.mockReset().mockResolvedValue(undefined);
  mocks.correct.mockReset().mockResolvedValue({
    success: true,
    attendanceId: "attendance-1",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("AttendanceCorrection", () => {
  test("固定の詳細復帰リンクを表示しない", () => {
    renderCorrection(working);
    expect(screen.queryByRole("link", { name: "勤怠詳細へ戻る" })).toBeNull();
  });

  test("現在値で初期化し、workingは退勤日時を省略して保存する", async () => {
    const user = userEvent.setup();
    renderCorrection(working);
    const current = screen.getByRole("region", {
      name: "現在登録されている勤怠",
    });
    const userCard = screen.getByRole("region", { name: "対象ユーザー" });
    expect(screen.queryByRole("heading", { name: "勤怠訂正" })).toBeNull();
    expect(
      within(userCard).getByText("有効スタッフ", { exact: true }),
    ).toBeTruthy();
    expect(
      within(current).queryByText("有効スタッフ", { exact: true }),
    ).toBeNull();
    expect(screen.queryByText("対象ユーザー:")).toBeNull();
    expect(
      within(current).getByText("2026/09/03", { exact: true }),
    ).toBeTruthy();
    expect(within(current).getByText("昼")).toBeTruthy();
    const workPeriodGroup = screen.getByRole("group", { name: "勤務区分" });
    const dayRadio = within(workPeriodGroup).getByRole("radio", { name: "昼" });
    expect(dayRadio).toHaveProperty("checked", true);
    expect((screen.getByLabelText("出勤日時") as HTMLInputElement).value).toBe(
      "2026-09-03T18:15",
    );
    expect(
      (screen.getByLabelText("訂正退勤日時") as HTMLInputElement).value,
    ).toBe("");

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.correct).toHaveBeenCalledWith({
        attendanceId: "attendance-1",
        changes: {
          expectedVersion: 2,
          workPeriod: "day",
          clockInAt: "2026-09-03T18:15:00+09:00",
        },
      }),
    );
  });

  test("現在値の未記録・未算出と0分を区別する", () => {
    const firstView = renderCorrection(working);
    const current = screen.getByRole("region", {
      name: "現在登録されている勤怠",
    });
    expect(within(current).getByText("未記録")).toBeTruthy();
    expect(within(current).getByText("未算出")).toBeTruthy();

    firstView.unmount();
    renderCorrection({
      ...completed,
      clockOutAt: "2026-09-04T00:00:00.000Z",
      workedMinutes: 0,
    });
    expect(
      within(
        screen.getByRole("region", { name: "現在登録されている勤怠" }),
      ).getByText("0:00"),
    ).toBeTruthy();
  });

  test("現在登録状態と訂正フォームに夜を表示する", () => {
    renderCorrection({ ...working, workPeriod: "night" });
    const current = screen.getByRole("region", {
      name: "現在登録されている勤怠",
    });
    expect(within(current).getByText("夜")).toBeTruthy();
    const formGroup = screen.getByRole("group", { name: "勤務区分" });
    const nightRadio = within(formGroup).getByRole("radio", { name: "夜" });
    expect(nightRadio).toHaveProperty("checked", true);
  });

  test("勤務区分ラジオをクリックとキーボードで切り替え、保存payloadへ反映する", async () => {
    const user = userEvent.setup();
    renderCorrection(working);
    const group = screen.getByRole("group", { name: "勤務区分" });
    const day = within(group).getByRole("radio", { name: "昼" });
    const night = within(group).getByRole("radio", { name: "夜" });

    await user.click(night);
    expect(day).toHaveProperty("checked", false);
    expect(night).toHaveProperty("checked", true);
    day.focus();
    await user.keyboard(" ");
    expect(day).toHaveProperty("checked", true);
    expect(night).toHaveProperty("checked", false);

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.correct).toHaveBeenCalledWith({
        attendanceId: "attendance-1",
        changes: {
          expectedVersion: 2,
          workPeriod: "day",
          clockInAt: "2026-09-03T18:15:00+09:00",
        },
      }),
    );
  });

  test("completedは退勤日時を必須とし、出退勤の前後関係を検証する", async () => {
    const user = userEvent.setup();
    renderCorrection(completed);
    const clockOut = screen.getByLabelText("訂正退勤日時");
    await user.clear(clockOut);
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("退勤日時を入力してください。"));
    expect(mocks.correct).not.toHaveBeenCalled();

    fireEvent.change(clockOut, { target: { value: "2026-09-03T09:14" } });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByText("退勤日時は出勤日時以降を指定してください。"),
    );
    expect(mocks.correct).not.toHaveBeenCalled();
  });

  test("contract validation errorを対応fieldへ表示する", async () => {
    const user = userEvent.setup();
    renderCorrection(working);
    const clockIn = screen.getByLabelText("出勤日時") as HTMLInputElement;
    clockIn.setAttribute("type", "text");
    fireEvent.change(clockIn, {
      target: { value: "2026-13-03T09:15" },
    });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("Invalid ISO datetime"));
    expect(mocks.correct).not.toHaveBeenCalled();
  });

  test("SESSION_EXPIREDは再認証後に一度だけretryし、successでdetailHrefへ戻る", async () => {
    const user = userEvent.setup();
    mocks.correct
      .mockResolvedValueOnce({
        success: false,
        code: "SESSION_EXPIRED",
        message: "期限切れ",
      })
      .mockResolvedValueOnce({ success: true, attendanceId: "attendance-1" });
    renderCorrection(working);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(mocks.correct).toHaveBeenCalledTimes(2);
      expect(mocks.reauthenticate).toHaveBeenCalledTimes(1);
      expect(mocks.replace).toHaveBeenCalledWith(
        "/admin/attendance/attendance-1?from=2026-09-01&to=2026-09-30",
      );
    });
  });

  test("non-conflict errorでは入力値を保持する", async () => {
    const user = userEvent.setup();
    mocks.correct.mockResolvedValueOnce({
      success: false,
      code: "ATTENDANCE_TIME_OVERLAP",
      message: "訂正できません。",
    });
    renderCorrection(working);
    const clockOut = screen.getByLabelText("訂正退勤日時");
    fireEvent.change(clockOut, { target: { value: "2026-09-03T19:00" } });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "訂正できません。",
    );
    expect((clockOut as HTMLInputElement).value).toBe("2026-09-03T19:00");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  test("pending中は保存とキャンセルを無効化する", async () => {
    const user = userEvent.setup();
    let resolveCorrection: ((value: unknown) => void) | undefined;
    mocks.correct.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCorrection = resolve;
        }),
    );
    renderCorrection(working);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(mocks.correct).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "保存中" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "キャンセル" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    resolveCorrection?.({ success: true, attendanceId: "attendance-1" });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
  });

  test("cancelでdetailHrefへ戻る", async () => {
    const user = userEvent.setup();
    renderCorrection(working);
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(mocks.replace).toHaveBeenCalledWith(
      "/admin/attendance/attendance-1?from=2026-09-01&to=2026-09-30",
    );
  });

  test("conflict時はrefreshし、入力値を保持したまま最新versionで再保存する", async () => {
    const user = userEvent.setup();
    mocks.correct.mockResolvedValueOnce({
      success: false,
      code: "ATTENDANCE_VERSION_CONFLICT",
      message: "競合しました。",
    });
    const view = renderCorrection(working);
    const clockIn = screen.getByLabelText("出勤日時") as HTMLInputElement;
    await user.click(screen.getByRole("radio", { name: "夜" }));
    fireEvent.change(clockIn, { target: { value: "2026-09-03T18:30" } });
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "他の操作により勤怠が更新されました。入力内容を保持したまま最新状態を確認し、もう一度保存してください。",
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    const latest = {
      ...working,
      eventVersion: 3,
      workPeriod: "night" as const,
      clockInAt: "2026-09-03T10:00:00.000Z",
    };
    view.rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AttendanceCorrection
          initialDetail={{ status: "ready", data: latest }}
          initialUsers={initialUsers}
          detailHref="/admin/attendance/attendance-1"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("2026/09/03 19:00")).toBeTruthy();
    expect((screen.getByLabelText("出勤日時") as HTMLInputElement).value).toBe(
      "2026-09-03T18:30",
    );
    expect(screen.getByText("2026/09/03 19:00")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(mocks.correct).toHaveBeenLastCalledWith({
        attendanceId: "attendance-1",
        changes: {
          expectedVersion: 3,
          workPeriod: "night",
          clockInAt: "2026-09-03T18:30:00+09:00",
        },
      }),
    );
  });

  test("cancelled Attendanceでは訂正フォームを表示しない", () => {
    renderCorrection(cancelled);
    const current = screen.getByRole("region", {
      name: "現在登録されている勤怠",
    });
    expect(within(current).getByText("昼")).toBeTruthy();
    expect(screen.getByText("取消済みの勤怠は訂正できません。"));
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(screen.queryByRole("group", { name: "勤務区分" })).toBeNull();
  });

  test.each(["working", "completed"] as const)(
    "他の管理者の%s勤怠は現在状態を表示するが訂正フォームを表示しない",
    (status) => {
      const target = {
        ...(status === "working" ? working : completed),
        userId: "admin-2",
        displayName: "別管理者",
      };
      renderCorrection(target);
      expect(
        screen.getByRole("region", { name: "現在登録されている勤怠" }),
      ).toBeTruthy();
      expect(screen.getByText("この勤怠は閲覧のみ可能です。")).toBeTruthy();
      expect(
        screen.queryByRole("form", { name: "勤怠訂正フォーム" }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
      expect(screen.queryByRole("group", { name: "勤務区分" })).toBeNull();
      expect(screen.queryByLabelText("出勤日時")).toBeNull();
      expect(mocks.correct).not.toHaveBeenCalled();
    },
  );

  test("管理者本人とスタッフは従来どおり訂正フォームを表示する", () => {
    renderCorrection(working);
    expect(screen.getByRole("form", { name: "勤怠訂正フォーム" })).toBeTruthy();

    cleanup();
    renderCorrection({ ...working, userId: "admin-1", displayName: "管理者" });
    expect(screen.getByRole("form", { name: "勤怠訂正フォーム" })).toBeTruthy();
  });

  test.each([
    { status: "error" as const, message: "ユーザー取得失敗" },
    {
      status: "unavailable" as const,
      code: "ADMIN_ACCESS_REQUIRED" as const,
      message: "権限がありません",
    },
    { status: "missing" as const, message: "ユーザーが見つかりません" },
  ])(
    "ユーザー一覧が取得できない場合は訂正フォームを表示しない",
    (usersState) => {
      renderCorrection(working, usersState);
      expect(screen.getByText("この勤怠は閲覧のみ可能です。")).toBeTruthy();
      expect(
        screen.queryByRole("form", { name: "勤怠訂正フォーム" }),
      ).toBeNull();
    },
  );

  test("対象ユーザーがstaffからadminへ変わると同じ勤怠でも訂正フォームを表示しない", () => {
    renderCorrection({
      ...working,
      userId: "admin-2",
      displayName: "別管理者",
    });
    expect(screen.getByText("この勤怠は閲覧のみ可能です。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  });
});
