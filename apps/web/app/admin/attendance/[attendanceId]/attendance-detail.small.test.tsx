import type { AdminAttendanceDetail } from "@repo/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AdminUsersState } from "../../../../lib/admin-user-management-types";
import { AttendanceDetail } from "./attendance-detail";

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

type TestAuthState =
  | { status: "ready"; user: { userId: string } }
  | { status: "checking" | "error" | "unavailable"; message: string };

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  reauthenticate: vi.fn(async () => undefined),
  cancel: vi.fn(),
  authState: {
    status: "ready" as const,
    user: { userId: "admin-1" },
  } as TestAuthState,
}));

vi.mock("../../_components/auth-provider.tsx", () => ({
  useAuth: () => ({
    authState: mocks.authState,
    reauthenticate: mocks.reauthenticate,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("../../_actions/attendance-actions.ts", () => ({
  cancelAdminAttendanceAction: mocks.cancel,
}));

const users = {
  status: "ready" as const,
  data: [
    {
      userId: "admin-1",
      displayName: "管理者",
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
      userId: "staff-1",
      displayName: "有効スタッフ",
      role: "staff" as const,
      status: "active" as const,
    },
  ],
};

function detail(
  status: AdminAttendanceDetail["status"],
  userId = "staff-1",
): AdminAttendanceDetail {
  return {
    attendanceId: "attendance-1",
    eventVersion: 2,
    attendanceDate: "2026-09-03",
    userId,
    displayName: "有効スタッフ",
    workPeriod: "day",
    clockInAt: "2026-09-03T09:15:00.000Z",
    clockOutAt: status === "completed" ? "2026-09-03T09:00:00.000Z" : null,
    workedMinutes: status === "completed" ? 525 : null,
    status,
    payroll:
      status === "cancelled"
        ? { hourlyWage: null, estimatedPayYen: null, status: "excluded" }
        : status === "working"
          ? {
              hourlyWage: 1200,
              estimatedPayYen: null,
              status: "clockOutMissing",
            }
          : { hourlyWage: 1200, estimatedPayYen: 10500, status: "calculated" },
    history: [
      {
        eventId: "event-1",
        attendanceId: "attendance-1",
        eventVersion: 1,
        performedByUserId: "admin-1",
        createdAt: "2026-09-03T09:20:00.000Z",
        eventType: "AttendanceClockedIn",
        payload: {
          userId: "staff-1",
          attendanceDate: "2026-09-03",
          workPeriod: "day",
          clockInAt: "2026-09-03T09:15:00.000Z",
        },
      },
    ],
  };
}

function renderDetail(
  value: AdminAttendanceDetail | null,
  correctionHref = "/admin/attendance/attendance-1/edit",
  initialUsers: AdminUsersState = users,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AttendanceDetail
        initialDetail={
          value
            ? { status: "ready", data: value }
            : { status: "missing", message: "勤怠が見つかりません。" }
        }
        initialUsers={initialUsers}
        correctionHref={correctionHref}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.authState = { status: "ready", user: { userId: "admin-1" } };
  mocks.refresh.mockReset();
  mocks.reauthenticate.mockReset();
  mocks.reauthenticate.mockResolvedValue(undefined);
  mocks.cancel.mockReset();
  mocks.cancel.mockResolvedValue({
    success: true,
    attendanceId: "attendance-1",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AttendanceDetail", () => {
  test("固定の一覧復帰リンクを表示しない", () => {
    renderDetail(detail("working"));
    expect(screen.queryByRole("link", { name: "勤怠一覧へ戻る" })).toBeNull();
  });
  test.each([
    ["working", "勤務中", "未記録"],
    ["completed", "退勤済み", "2026/09/03 18:00"],
    ["cancelled", "取消済み", "未記録"],
  ] as const)("%sの現在状態を表示する", (status, label, clockOut) => {
    renderDetail(detail(status));
    const summary = screen.getByRole("region", { name: "勤怠の現在状態" });
    const userCard = screen.getByRole("region", { name: "対象ユーザー" });
    expect(screen.queryByRole("heading", { name: "勤怠詳細" })).toBeNull();
    expect(
      within(userCard).getByText("有効スタッフ", { exact: true }),
    ).toBeTruthy();
    expect(
      within(summary).queryByText("有効スタッフ", { exact: true }),
    ).toBeNull();
    expect(screen.queryByText("対象ユーザー:")).toBeNull();
    expect(
      within(summary).getByText("2026/09/03", { exact: true }),
    ).toBeTruthy();
    expect(within(summary).getByText("昼")).toBeTruthy();
    expect(screen.getByText("2026/09/03 18:15")).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getAllByText(clockOut).length).toBeGreaterThan(0);
    expect(
      within(summary)
        .getByRole("link", { name: "時給設定を確認" })
        .getAttribute("href"),
    ).toBe("/admin/users/staff-1/hourly-wage-rates?date=2026-09-03");
    if (status === "completed") expect(screen.getByText("8:45")).toBeTruthy();
    if (status === "working") {
      expect(screen.getByText("未記録")).toBeTruthy();
      expect(screen.getByText("未算出")).toBeTruthy();
    }
  });

  test("時給未設定でも対象ユーザーと勤怠日を encode した確認リンクを表示する", () => {
    renderDetail({
      ...detail("completed", "staff /1"),
      attendanceDate: "2026-09-20",
      payroll: {
        hourlyWage: null,
        estimatedPayYen: null,
        status: "missingHourlyWage",
      },
    });
    const summary = screen.getByRole("region", { name: "勤怠の現在状態" });
    expect(within(summary).getAllByText("時給未設定")).toHaveLength(2);
    expect(
      within(summary)
        .getByRole("link", { name: "時給設定を確認" })
        .getAttribute("href"),
    ).toBe("/admin/users/staff%20%2F1/hourly-wage-rates?date=2026-09-20");
  });

  test("0分と翌日の退勤日時を実データどおりに表示する", () => {
    renderDetail({
      ...detail("completed"),
      clockInAt: "2026-09-03T14:00:00.000Z",
      clockOutAt: "2026-09-04T00:00:00.000Z",
      workedMinutes: 0,
    });
    const summary = screen.getByRole("region", { name: "勤怠の現在状態" });
    expect(within(summary).getByText("2026/09/04 09:00")).toBeTruthy();
    expect(within(summary).getByText("0:00")).toBeTruthy();
  });

  test.each([
    [
      { hourlyWage: 1200, estimatedPayYen: 10500, status: "calculated" },
      "1,200円/時",
      "10,500円",
    ],
    [
      { hourlyWage: 0, estimatedPayYen: 0, status: "calculated" },
      "0円/時",
      "0円",
    ],
    [
      { hourlyWage: null, estimatedPayYen: null, status: "missingHourlyWage" },
      "時給未設定",
      "時給未設定",
    ],
    [
      { hourlyWage: 1200, estimatedPayYen: null, status: "clockOutMissing" },
      "1,200円/時",
      "退勤未記録",
    ],
    [
      { hourlyWage: 1200, estimatedPayYen: null, status: "incomplete" },
      "1,200円/時",
      "勤怠不完全",
    ],
    [
      { hourlyWage: null, estimatedPayYen: null, status: "excluded" },
      "給与集計対象外",
      "給与集計対象外",
    ],
  ] as const)(
    "給与計算状態を誤認なく表示する",
    (payroll, wage, estimatedPay) => {
      renderDetail({ ...detail("completed"), payroll });
      const summary = screen.getByRole("region", { name: "勤怠の現在状態" });
      expect(within(summary).getAllByText(wage).length).toBeGreaterThan(0);
      expect(within(summary).getAllByText(estimatedPay).length).toBeGreaterThan(
        0,
      );
    },
  );

  test("現在状態に夜の勤務区分を表示する", () => {
    renderDetail({ ...detail("working"), workPeriod: "night" });
    const summary = screen.getByRole("region", { name: "勤怠の現在状態" });
    expect(within(summary).getByText("夜")).toBeTruthy();
  });

  test("履歴は人間向けJST表示と操作者名を維持する", () => {
    renderDetail(detail("working"));
    expect(screen.getByText("出勤を記録（2026/09/03 18:15）")).toBeTruthy();
    expect(screen.getByText("2026/09/03 18:20")).toBeTruthy();
    expect(screen.getByText("操作者：管理者")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("AttendanceCancelledの履歴を勤怠全体の取消として表示する", () => {
    const cancelled = detail("cancelled");
    renderDetail({
      ...cancelled,
      history: [
        ...cancelled.history,
        {
          eventId: "event-cancelled",
          attendanceId: cancelled.attendanceId,
          eventVersion: 2,
          performedByUserId: "admin-1",
          createdAt: "2026-09-03T10:00:00.000Z",
          eventType: "AttendanceCancelled",
          payload: {},
        },
      ],
    });
    expect(screen.getByText("勤怠を取消", { exact: true })).toBeTruthy();
    expect(screen.queryByText("退勤を取消", { exact: true })).toBeNull();
  });

  test("workingとcompletedには訂正と取消だけを表示し、cancelledには操作を表示しない", () => {
    renderDetail(detail("working"));
    expect(screen.getByRole("link", { name: "訂正" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();

    cleanup();
    renderDetail(detail("completed"));
    expect(screen.getByRole("link", { name: "訂正" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();

    cleanup();
    renderDetail(detail("cancelled"));
    expect(screen.queryByRole("button", { name: "訂正" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
  });

  test.each(["working", "completed"] as const)(
    "他の管理者の%s勤怠は現在状態と変更履歴を表示するが操作を表示しない",
    (status) => {
      renderDetail(detail(status, "admin-2"));
      expect(
        screen.getByRole("region", { name: "勤怠の現在状態" }),
      ).toBeTruthy();
      expect(screen.getByRole("heading", { name: "変更履歴" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "訂正" })).toBeNull();
      expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
    },
  );

  test("管理者本人の勤怠には操作を表示する", () => {
    renderDetail(detail("completed", "admin-1"));
    expect(screen.getByRole("link", { name: "訂正" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消" })).toBeTruthy();
  });

  test.each([
    { status: "error" as const, message: "ユーザー取得失敗" },
    {
      status: "unavailable" as const,
      code: "ADMIN_ACCESS_REQUIRED" as const,
      message: "権限がありません",
    },
    { status: "missing" as const, message: "ユーザーが見つかりません" },
  ])("ユーザー一覧が取得できない場合は操作を表示しない", (initialUsers) => {
    renderDetail(detail("working"), undefined, initialUsers);
    expect(screen.getByRole("region", { name: "勤怠の現在状態" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "訂正" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
  });

  test("readyでも対象者が一覧にいない場合は操作を表示しない", () => {
    renderDetail(detail("working"), undefined, {
      status: "ready",
      data: [users.data[0], users.data[1]],
    });
    expect(screen.getByRole("region", { name: "勤怠の現在状態" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "訂正" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
  });

  test("詳細の訂正はcanonicalなcorrectionHrefへのlinkを表示する", () => {
    renderDetail(
      detail("working"),
      "/admin/attendance/attendance-1/edit?from=2026-09-01&to=2026-09-30",
    );
    expect(
      screen.getByRole("link", { name: "訂正" }).getAttribute("href"),
    ).toBe("/admin/attendance/attendance-1/edit?from=2026-09-01&to=2026-09-30");
  });

  test("単一の全体取消Dialogは確認だけを行い、attendanceIdとexpectedVersionを送る", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm");
    renderDetail(detail("completed"));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(mocks.cancel).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("勤怠を取消")).toBeTruthy();
    expect(dialog.textContent).toContain("取消後は元に戻せません。");
    expect(dialog.textContent).toContain("有効スタッフ");
    expect(dialog.textContent).toContain("2026/09/03");
    expect(within(dialog).getByText("昼")).toBeTruthy();
    expect(dialog.textContent).not.toContain("退勤のみ");
    expect(dialog.textContent).not.toContain("勤務全体");
    expect(confirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "取消する" }));
    await waitFor(() =>
      expect(mocks.cancel).toHaveBeenCalledWith({
        attendanceId: "attendance-1",
        expectedVersion: 2,
      }),
    );
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  test("夜の取消Dialogに夜の勤務区分を表示する", async () => {
    const user = userEvent.setup();
    renderDetail({ ...detail("working"), workPeriod: "night" });
    await user.click(screen.getByRole("button", { name: "取消" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("夜")).toBeTruthy();
  });

  test("取消DialogはキャンセルとEscapeで閉じ、actionを呼ばない", async () => {
    const user = userEvent.setup();
    renderDetail(detail("completed"));
    await user.click(screen.getByRole("button", { name: "取消" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("勤怠を取消")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  test("cancellationのconflictと通常失敗を詳細に表示する", async () => {
    const user = userEvent.setup();
    mocks.cancel.mockResolvedValueOnce({
      success: false,
      code: "ATTENDANCE_VERSION_CONFLICT",
      message: "競合しました。",
    });
    renderDetail(detail("completed"));
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "取消する" }));
    expect(
      await screen.findByText(
        "他の操作により勤怠が更新されました。最新の内容を確認してください。",
      ),
    ).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalled();

    cleanup();
    mocks.cancel.mockResolvedValueOnce({
      success: false,
      message: "取消できませんでした。",
    });
    renderDetail(detail("completed"));
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "取消する" }));
    expect(await screen.findByText("取消できませんでした。")).toBeTruthy();
  });

  test("取消中は再操作でactionを重複実行せず、確定ボタンを無効化する", async () => {
    const user = userEvent.setup();
    let resolveCancellation!: (value: {
      success: true;
      attendanceId: string;
    }) => void;
    mocks.cancel.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCancellation = resolve;
      }),
    );
    renderDetail(detail("completed"));
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "取消する" }));
    expect(screen.getByRole("button", { name: "取消中..." })).toHaveProperty(
      "disabled",
      true,
    );
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    resolveCancellation({ success: true, attendanceId: "attendance-1" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("missingとgeneric errorは状態を区別して表示する", () => {
    const missing = renderDetail(null);
    expect(screen.getByText("勤怠が見つかりません。")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "勤怠詳細" })).toBeNull();
    missing.unmount();

    render(
      <AttendanceDetail
        initialDetail={{
          status: "error",
          message: "勤怠詳細を取得できませんでした。",
        }}
        initialUsers={users}
        correctionHref="/admin/attendance/attendance-1/edit"
      />,
    );
    expect(screen.getByText("勤怠詳細を取得できませんでした。")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "勤怠詳細" })).toBeNull();
  });

  test("認証checking / error / unavailableは詳細を誤表示しない", () => {
    mocks.authState = { status: "checking", message: "認証を確認しています" };
    const checking = renderDetail(detail("working"));
    expect(screen.getByText("認証を確認しています")).toBeTruthy();
    expect(screen.queryByText("有効スタッフ")).toBeNull();
    checking.unmount();

    mocks.authState = { status: "error", message: "認証に失敗しました" };
    const error = renderDetail(detail("working"));
    expect(screen.getByText("認証に失敗しました")).toBeTruthy();
    expect(screen.queryByText("有効スタッフ")).toBeNull();
    error.unmount();

    mocks.authState = {
      status: "unavailable",
      message: "管理者権限が必要です",
    };
    renderDetail(detail("working"));
    expect(screen.getByText("管理者権限が必要です")).toBeTruthy();
    expect(screen.queryByText("有効スタッフ")).toBeNull();
  });
});
