import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import type { StaffAttendanceHistoryReadState } from "../../../lib/staff-attendance-types";
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
vi.mock("../../../env", () => ({
  env: { NEXT_PUBLIC_LIFF_ID: "test-liff-id" },
}));
vi.mock("@line/liff", () => ({ default: mocks.liff }));
vi.mock("../_actions/auth-actions.ts", () => ({
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
    <HistoryClient
      initialAuth={initialAuth}
      selectedMonth={selectedMonth}
      initialAttendanceHistory={initialAttendanceHistory}
    />,
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

  test("month navigationはhistory routeへscrollなしでreplaceする", async () => {
    const { getByRole } = renderHistory({ status: "ready", data: [] });
    getByRole("button", { name: "前の月" }).click();
    expect(mocks.replace).toHaveBeenCalledWith("/history?month=2026-08", {
      scroll: false,
    });
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
      <HistoryClient
        initialAuth={{ status: "missing", message: "ログインが必要です。" }}
        selectedMonth="2026-09"
        initialAttendanceHistory={null}
      />,
    );

    expect(screen.getByText("認証を確認中")).toBeTruthy();
    expect(screen.getByText("ログイン状態を確認しています。")).toBeTruthy();
    expect(screen.queryByText("2026年9月")).toBeNull();
    expect(screen.queryByText("09:00")).toBeNull();
  });
});
