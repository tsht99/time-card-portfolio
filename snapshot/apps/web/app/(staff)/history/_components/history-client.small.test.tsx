import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AuthBootstrapState } from "../../../../lib/auth-types";
import { StaffAuthScopeBoundary } from "../../_components/staff-auth-scope-boundary.tsx";
import type { StaffAttendanceHistoryReadState } from "../../_lib/staff-attendance-types";
import { HistoryClient } from "./history-client.tsx";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  createSession: vi.fn(),
  liff: {
    init: vi.fn(async () => undefined),
    getIDToken: vi.fn(() => "id-token"),
    getAccessToken: vi.fn(() => "access-token"),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("../../../../env", () => ({
  env: {
    NEXT_PUBLIC_LIFF_ID: "test-liff-id",
    NEXT_PUBLIC_HELP_URL: "https://help.example.test",
  },
}));
vi.mock("@line/liff", () => ({ default: mocks.liff }));
vi.mock("../../_actions/auth-actions.ts", () => ({
  createStaffLineSessionAction: mocks.createSession,
}));

const readyAuth = {
  status: "ready" as const,
  user: {
    userId: "staff-1",
    displayName: "スタッフ",
    role: "staff" as const,
    status: "active" as const,
  },
} satisfies AuthBootstrapState;

function attendance(
  attendanceId: string,
  workPeriod: "day" | "night" = "day",
  clockOutAt: string | null = "2026-09-01T09:00:00.000Z",
) {
  return {
    attendanceId,
    eventVersion: 1,
    attendanceDate: "2026-09-01",
    workPeriod,
    clockInAt: "2026-09-01T00:00:00.000Z",
    clockOutAt,
    workedMinutes: clockOutAt ? 540 : null,
  };
}

function renderHistory(
  initialAttendanceHistory: StaffAttendanceHistoryReadState | null,
  initialAuth: AuthBootstrapState = readyAuth,
  selectedMonth = "2026-09",
) {
  return render(
    historyElement(initialAttendanceHistory, initialAuth, selectedMonth),
    {
      wrapper: withNuqsTestingAdapter({
        searchParams: "",
        onUrlUpdate: mocks.replace,
      }),
    },
  );
}

function historyElement(
  initialAttendanceHistory: StaffAttendanceHistoryReadState | null,
  initialAuth: AuthBootstrapState,
  selectedMonth: string,
) {
  return (
    <StaffAuthScopeBoundary initialAuth={initialAuth}>
      <HistoryClient
        initialAuth={initialAuth}
        selectedMonth={selectedMonth}
        initialAttendanceHistory={initialAttendanceHistory}
      />
    </StaffAuthScopeBoundary>
  );
}

afterEach(() => {
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.createSession.mockReset();
  mocks.liff.init.mockClear();
});

describe("history client", () => {
  test("ready historyでは共通ナビゲーションを表示し旧リンクを表示しない", () => {
    renderHistory({ status: "ready", data: [] });

    expect(
      screen.getByRole("link", { name: "打刻" }).getAttribute("href"),
    ).toBe("/clock");
    expect(
      screen.getByRole("link", { name: "履歴" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("link", { name: "打刻画面へ戻る" })).toBeNull();
  });

  test("ready historyを対象月・勤務日・昼夜・出退勤時刻付きで表示する", () => {
    renderHistory({
      status: "ready",
      data: [attendance("day-1", "day"), attendance("night-1", "night")],
    });

    expect(screen.getByText("2026年9月")).toBeTruthy();
    expect(screen.getAllByText("1日")).toHaveLength(2);
    expect(screen.getByText("昼")).toBeTruthy();
    expect(screen.getByText("夜")).toBeTruthy();
    expect(screen.getAllByText("09:00")).toHaveLength(2);
    expect(screen.getAllByText("18:00")).toHaveLength(2);
  });

  test("同一日同一区分の複数Attendanceを全件表示する", () => {
    renderHistory({
      status: "ready",
      data: [
        attendance("day-1", "day"),
        attendance("day-2", "day", "2026-09-01T10:00:00.000Z"),
      ],
    });

    expect(screen.getAllByText("昼")).toHaveLength(2);
    expect(screen.getByText("19:00")).toBeTruthy();
  });

  test("clockOutAtがnullなら勤務中を表示する", () => {
    renderHistory({
      status: "ready",
      data: [attendance("day-1", "day", null)],
    });
    expect(screen.getByText("勤務中")).toBeTruthy();
  });

  test("0件では空月messageを表示する", () => {
    renderHistory({ status: "ready", data: [] });
    expect(screen.getByText("この月の打刻はありません。")).toBeTruthy();
  });

  test("read failureではerrorと再試行操作を表示する", () => {
    renderHistory({
      status: "error",
      message: "勤怠履歴を取得できませんでした。",
    });
    expect(screen.getByText("勤怠履歴を取得できませんでした。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
  });

  test("month navigationはreplaceでserver updateしscroll位置を保つ", async () => {
    renderHistory({ status: "ready", data: [] });
    fireEvent.click(screen.getByRole("button", { name: "前の月" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: "?month=2026-08",
        options: expect.objectContaining({
          history: "replace",
          shallow: false,
          scroll: false,
        }),
      }),
    );
  });

  test("編集・取消操作やdialogを表示しない", () => {
    renderHistory({ status: "ready", data: [attendance("day-1")] });
    expect(screen.queryByRole("button", { name: /編集|取消/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("readyでない認証状態では空月ではなく認証状態を表示する", () => {
    renderHistory(null, {
      status: "error",
      message: "認証状態を確認できませんでした。",
    });
    expect(screen.getByText("認証状態を確認できませんでした。")).toBeTruthy();
    expect(screen.queryByText("この月の打刻はありません。")).toBeNull();
    expect(
      screen.getByRole("link", { name: "打刻" }).getAttribute("href"),
    ).toBe("/clock");
    expect(
      screen.getByRole("link", { name: "履歴" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByRole("link", { name: "打刻画面へ戻る" })).toBeNull();
  });

  test("認証確認中は以前の履歴snapshotを表示しない", () => {
    mocks.createSession.mockReturnValue(new Promise(() => undefined));
    renderHistory(
      {
        status: "ready",
        data: [attendance("day-1")],
      },
      { status: "missing", message: "ログインが必要です。" },
    );

    expect(screen.getByText("認証を確認中")).toBeTruthy();
    expect(screen.getByText("ログイン状態を確認しています。")).toBeTruthy();
    expect(screen.queryByText("2026年9月")).toBeNull();
    expect(screen.queryByText("09:00")).toBeNull();
  });

  test("readyからmissingへ変化した直後は以前の履歴snapshotを表示しない", () => {
    const { rerender } = renderHistory({
      status: "ready",
      data: [attendance("day-1")],
    });
    expect(screen.getByText("2026年9月")).toBeTruthy();

    mocks.createSession.mockReturnValue(new Promise(() => undefined));
    rerender(
      historyElement(
        null,
        { status: "missing", message: "ログインが必要です。" },
        "2026-09",
      ),
    );

    expect(screen.getByText("認証を確認中")).toBeTruthy();
    expect(screen.getByText("ログイン状態を確認しています。")).toBeTruthy();
    expect(screen.queryByText("2026年9月")).toBeNull();
    expect(screen.queryByText("09:00")).toBeNull();
  });

  test("another ready userの取得失敗で以前のsnapshotをfallbackしない", () => {
    const { rerender } = renderHistory({
      status: "ready",
      data: [attendance("staff-a-row")],
    });
    expect(screen.getByText("09:00")).toBeTruthy();

    const otherStaff: AuthBootstrapState = {
      ...readyAuth,
      user: { ...readyAuth.user, userId: "staff-2", displayName: "別スタッフ" },
    };
    rerender(
      historyElement(
        {
          status: "error",
          message: "勤怠履歴を取得できませんでした。",
        },
        otherStaff,
        "2026-09",
      ),
    );

    expect(screen.getByText("勤怠履歴を取得できませんでした。")).toBeTruthy();
    expect(screen.queryByText("09:00")).toBeNull();
    expect(screen.queryByText("この月の打刻はありません。")).toBeNull();
  });

  test("ready userが切り替わると新しいuserの履歴だけを表示する", () => {
    const { rerender } = renderHistory({
      status: "ready",
      data: [attendance("staff-a-row")],
    });
    expect(screen.getByText("09:00")).toBeTruthy();

    const otherStaff: AuthBootstrapState = {
      ...readyAuth,
      user: { ...readyAuth.user, userId: "staff-2", displayName: "別スタッフ" },
    };
    rerender(
      historyElement(
        {
          status: "ready",
          data: [
            {
              ...attendance("staff-b-row"),
              clockInAt: "2026-09-01T01:00:00.000Z",
            },
          ],
        },
        otherStaff,
        "2026-09",
      ),
    );

    expect(screen.getByText("10:00")).toBeTruthy();
    expect(screen.queryByText("09:00")).toBeNull();
  });

  test("同一ready userの取得失敗では同月snapshotをstale fallbackする", () => {
    const { rerender } = renderHistory({
      status: "ready",
      data: [attendance("same-staff-row")],
    });

    rerender(
      historyElement(
        {
          status: "error",
          message: "勤怠履歴を取得できませんでした。",
        },
        readyAuth,
        "2026-09",
      ),
    );

    expect(screen.getByText("09:00")).toBeTruthy();
    expect(screen.getByText("勤怠の更新に失敗しました。")).toBeTruthy();
  });
});
