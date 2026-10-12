import type { StaffAttendanceItem } from "@repo/contracts";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import type { StaffCurrentAttendanceReadState } from "../_lib/staff-attendance-types";
import { StaffAuthScopeBoundary } from "./staff-auth-scope-boundary.tsx";
import { StaffPage } from "./staff-page.tsx";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    refresh,
    router: { refresh },
    createSession: vi.fn(),
    clock: vi.fn(),
    liff: {
      init: vi.fn(async () => undefined),
      getIDToken: vi.fn(() => "test-id-token"),
      getAccessToken: vi.fn(() => "test-access-token"),
    },
  };
});

vi.mock("../../../env", () => ({
  env: {
    NEXT_PUBLIC_LIFF_ID: "test-liff-id",
    NEXT_PUBLIC_HELP_URL: "https://help.example.test",
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));
vi.mock("@line/liff", () => ({ default: mocks.liff }));
vi.mock("../_actions/auth-actions.ts", () => ({
  createStaffLineSessionAction: mocks.createSession,
}));
vi.mock("../_actions/attendance-actions.ts", () => ({
  clockStaffAttendanceAction: mocks.clock,
}));

const readyAuth = {
  status: "ready",
  user: {
    userId: "staff-1",
    displayName: "スタッフ",
    role: "staff",
    status: "active",
  },
} satisfies AuthBootstrapState;

const missingAuth = {
  status: "missing",
  message: "ログインが必要です。",
} satisfies AuthBootstrapState;

function attendanceItem(
  attendanceId: string,
  attendanceDate: string,
  workPeriod: "day" | "night" = "day",
  overrides: Partial<StaffAttendanceItem> = {},
): StaffAttendanceItem {
  return {
    attendanceId,
    eventVersion: 1,
    attendanceDate,
    workPeriod,
    clockInAt: `${attendanceDate}T09:00:00.000Z`,
    clockOutAt: null,
    workedMinutes: null,
    ...overrides,
  };
}

type StaffAttendanceFixture = {
  current: StaffCurrentAttendanceReadState;
};

const snapshot: StaffAttendanceFixture = {
  current: {
    status: "ready",
    data: { referenceDate: "2026-09-01", attendances: [] },
  },
};

function renderStaffPage(
  initialAuth: AuthBootstrapState = readyAuth,
  initialAttendance: StaffAttendanceFixture | null = snapshot,
) {
  return render(staffPageElement(initialAuth, initialAttendance));
}

function staffPageElement(
  initialAuth: AuthBootstrapState,
  initialAttendance: StaffAttendanceFixture | null,
) {
  return (
    <StaffAuthScopeBoundary initialAuth={initialAuth}>
      <StaffPage
        initialAuth={initialAuth}
        initialCurrentAttendance={initialAttendance?.current ?? null}
      />
    </StaffAuthScopeBoundary>
  );
}

function currentTokyoDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    new Date(),
  );
}

function workingSnapshot(workPeriod: "day" | "night" = "day") {
  const date = currentTokyoDate();
  return {
    current: {
      status: "ready" as const,
      data: {
        referenceDate: date,
        attendances: [
          {
            attendanceId: "working-1",
            eventVersion: 1,
            attendanceDate: date,
            workPeriod,
            clockInAt: `${date}T00:00:00.000Z`,
            clockOutAt: null,
            workedMinutes: null,
          },
        ],
      },
    },
  } satisfies StaffAttendanceFixture;
}

afterEach(() => {
  vi.useRealTimers();
  mocks.refresh.mockReset();
  mocks.createSession.mockReset();
  mocks.clock.mockReset();
  mocks.liff.init.mockClear();
  mocks.liff.getIDToken.mockClear();
  mocks.liff.getAccessToken.mockClear();
});

describe("staff の打刻画面", () => {
  test("missing sessionの認証成功後はserver dataを再取得する", async () => {
    mocks.createSession.mockResolvedValue({ data: readyAuth.user });
    renderStaffPage(missingAuth);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());

    expect(mocks.createSession).toHaveBeenCalled();
    expect(mocks.liff.init).toHaveBeenCalled();
    expect(mocks.clock).not.toHaveBeenCalled();
  });

  test("主体変更・認証中は旧画面状態を破棄し、新主体の取得失敗で旧snapshotを表示しない", async () => {
    const user = userEvent.setup();
    mocks.createSession.mockResolvedValue({ data: readyAuth.user });
    const { rerender } = renderStaffPage(readyAuth, workingSnapshot("day"));

    const time = screen.getByLabelText(/打刻時刻/);
    await user.clear(time);
    await user.type(time, "22:10");
    expect((time as HTMLInputElement).value).toBe("22:10");
    expect(screen.getByRole("button", { name: "退勤" })).toHaveProperty(
      "disabled",
      false,
    );

    rerender(
      staffPageElement(
        { status: "error", message: "認証を確認できません。" },
        workingSnapshot("day"),
      ),
    );
    expect(screen.getByText("認証を確認できません")).toBeTruthy();
    expect(screen.queryByLabelText(/打刻時刻/)).toBeNull();
    expect(screen.queryByText("昼勤務中")).toBeNull();

    rerender(staffPageElement(missingAuth, workingSnapshot("day")));
    expect(await screen.findByText("認証を確認中")).toBeTruthy();
    expect(screen.queryByLabelText(/打刻時刻/)).toBeNull();
    expect(screen.queryByText("昼勤務中")).toBeNull();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));

    const anotherStaff: AuthBootstrapState = {
      ...readyAuth,
      user: { ...readyAuth.user, userId: "staff-2", displayName: "別スタッフ" },
    };
    rerender(
      staffPageElement(anotherStaff, {
        current: {
          status: "error",
          message: "現在の勤怠を取得できませんでした。",
        },
      }),
    );

    expect(screen.getByText("現在の勤怠を取得できませんでした。")).toBeTruthy();
    expect(
      screen.queryByText("最新の勤務状態を取得できませんでした。"),
    ).toBeNull();
    expect(screen.queryByText("昼勤務中")).toBeNull();
    expect(screen.queryByRole("button", { name: "退勤" })).toBeNull();
    expect(screen.queryByLabelText(/打刻時刻/)).toBeNull();
  });

  test("同一主体での再取得失敗では既存snapshotをstale表示する", () => {
    const { rerender } = renderStaffPage(readyAuth, workingSnapshot());

    rerender(
      staffPageElement(readyAuth, {
        current: {
          status: "error",
          message: "現在の勤怠を取得できませんでした。",
        },
      }),
    );

    expect(screen.getByText("昼勤務中")).toBeTruthy();
    expect(
      screen.getByText("最新の勤務状態を取得できませんでした。"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "退勤" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  test("認証確認中は保持済み勤怠を表示しない", async () => {
    mocks.liff.init.mockImplementationOnce(() => new Promise(() => undefined));
    renderStaffPage(missingAuth, workingSnapshot());

    await waitFor(() => expect(mocks.liff.init).toHaveBeenCalled());
    expect(screen.getByText("認証を確認中")).toBeTruthy();
    expect(screen.getByText("ログイン状態を確認しています。")).toBeTruthy();
    expect(screen.queryByText("昼勤務中")).toBeNull();
    expect(screen.queryByLabelText("打刻時刻")).toBeNull();
    expect(screen.queryByRole("button", { name: "退勤" })).toBeNull();
  });

  test("勤務中の退勤は表示済みtargetを付けた通常clock-outを送る", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({ data: undefined });
    renderStaffPage(readyAuth, workingSnapshot());
    const time = screen.getByLabelText(/打刻時刻/);
    await user.clear(time);
    await user.type(time, "22:10");
    await user.click(screen.getByRole("button", { name: "退勤" }));
    await waitFor(() =>
      expect(mocks.clock).toHaveBeenCalledWith({
        eventType: "clock_out",
        workPeriod: "day",
        occurredAt: `${currentTokyoDate()}T22:10:00+09:00`,
        targetAttendanceId: "working-1",
        targetEventVersion: 1,
      }),
    );
    await waitFor(() =>
      expect(mocks.clock).toHaveBeenCalledWith({
        eventType: "clock_out",
        workPeriod: "day",
        occurredAt: `${currentTokyoDate()}T22:10:00+09:00`,
        targetAttendanceId: "working-1",
        targetEventVersion: 1,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("clock action uses the Server Action and refreshes server data", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({ data: undefined });
    renderStaffPage();

    const time = screen.getByLabelText(/打刻時刻/);
    await user.clear(time);
    await user.type(time, "09:00");
    await user.click(screen.getByRole("button", { name: "昼に出勤" }));
    await waitFor(() => expect(mocks.clock).toHaveBeenCalledTimes(1));
    expect(mocks.clock).toHaveBeenCalledWith({
      eventType: "clock_in",
      workPeriod: "day",
      occurredAt: `${currentTokyoDate()}T09:00:00+09:00`,
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  test("同日の完了済み勤怠があっても通常clock-inとして送信する", async () => {
    const user = userEvent.setup();
    const date = currentTokyoDate();
    mocks.clock.mockResolvedValue({ data: undefined });
    renderStaffPage(readyAuth, {
      current: {
        status: "ready",
        data: {
          referenceDate: date,
          attendances: [
            attendanceItem("completed-1", date, "day", {
              clockInAt: `${date}T00:00:00.000Z`,
              clockOutAt: `${date}T08:00:00.000Z`,
            }),
          ],
        },
      },
    });

    await user.click(screen.getByRole("button", { name: "昼に出勤" }));

    await waitFor(() => expect(mocks.clock).toHaveBeenCalledTimes(1));
    expect(mocks.clock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "clock_in", workPeriod: "day" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("打刻日不一致は再読み込みを案内し、自動更新・再送しない", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({
      serverError: {
        code: "ATTENDANCE_PROCESSING_DATE_MISMATCH",
        message:
          "勤怠の状態が更新されています。打刻日がサーバー上の日付と一致しません。画面を再読み込みして最新の日付を確認してから、もう一度操作してください。",
      },
    });
    renderStaffPage(readyAuth, workingSnapshot());

    await user.click(screen.getByRole("button", { name: "退勤" }));

    await waitFor(() => expect(mocks.clock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.refresh).not.toHaveBeenCalled());
    expect(mocks.clock).toHaveBeenCalledWith({
      eventType: "clock_out",
      workPeriod: "day",
      occurredAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/,
      ),
      targetAttendanceId: "working-1",
      targetEventVersion: 1,
    });
    expect(
      screen.getByText(
        "打刻日がサーバー上の日付と一致しません。画面を再読み込みして最新の日付を確認してから、もう一度操作してください",
        {
          exact: false,
        },
      ),
    ).toBeTruthy();
  });

  test("未知のserver errorでは内部messageを隠し、再送しない", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({
      serverError: {
        code: "ACTION_FAILED",
        message: "database host=db.internal password=secret",
      },
    });
    renderStaffPage();

    await user.click(screen.getByRole("button", { name: "昼に出勤" }));

    expect(await screen.findByText(/打刻を完了できませんでした/)).toBeTruthy();
    expect(screen.queryByText(/db\.internal|secret/)).toBeNull();
    expect(mocks.clock).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "昼に出勤" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  test("既知の勤務中エラーは具体的な退勤案内を表示する", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({
      serverError: {
        code: "ATTENDANCE_ALREADY_WORKING",
        message: "internal detail",
      },
    });
    renderStaffPage();

    await user.click(screen.getByRole("button", { name: "昼に出勤" }));

    expect(
      await screen.findByText(
        "退勤していない勤務があります。先に退勤してください。",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/internal detail/)).toBeNull();
    expect(mocks.clock).toHaveBeenCalledOnce();
  });

  test("予期しない例外では内部messageを隠し、loadingを解除する", async () => {
    const user = userEvent.setup();
    mocks.clock.mockRejectedValue(new Error("private stack detail"));
    renderStaffPage();

    await user.click(screen.getByRole("button", { name: "昼に出勤" }));

    expect(await screen.findByText(/打刻を完了できませんでした/)).toBeTruthy();
    expect(screen.queryByText(/private stack detail/)).toBeNull();
    expect(mocks.clock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "昼に出勤" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  test("既知の重複エラーは退勤向けの具体的な案内を表示する", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({
      serverError: {
        code: "ATTENDANCE_TIME_OVERLAP",
        message: "internal overlap details",
      },
    });
    renderStaffPage(readyAuth, workingSnapshot());

    await user.click(screen.getByRole("button", { name: "退勤" }));

    expect(
      await screen.findByText(/管理者に勤怠の確認を依頼してください/),
    ).toBeTruthy();
    expect(screen.queryByText(/internal overlap details/)).toBeNull();
    expect(mocks.clock).toHaveBeenCalledOnce();
  });

  test("session expiry reauthenticates without punching, then refreshes latest attendance", async () => {
    const user = userEvent.setup();
    mocks.clock
      .mockResolvedValueOnce({
        serverError: {
          code: "SESSION_EXPIRED",
          message: "ログイン状態が切れています。",
        },
      })
      .mockResolvedValueOnce({ data: undefined });
    mocks.createSession.mockResolvedValue({ data: readyAuth.user });
    renderStaffPage();

    const time = screen.getByLabelText(/打刻時刻/);
    await user.clear(time);
    await user.type(time, "09:00");

    await user.click(screen.getByRole("button", { name: "昼に出勤" }));
    await waitFor(() => expect(mocks.clock).toHaveBeenCalledOnce());
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalled();
    expect(
      await screen.findByText(/元の打刻は記録されていません/),
    ).toBeTruthy();
  });

  test("別主体へ再認証した場合は再打刻せずrefresh中の画面へ移る", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({
      serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
    });
    mocks.createSession.mockResolvedValue({
      data: { ...readyAuth.user, userId: "staff-2", displayName: "別スタッフ" },
    });
    renderStaffPage(readyAuth, workingSnapshot());

    await user.click(screen.getByRole("button", { name: "退勤" }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.clock).toHaveBeenCalledOnce();
    expect(screen.getByText("認証を確認中")).toBeTruthy();
    expect(screen.queryByText("昼勤務中")).toBeNull();
    expect(screen.queryByLabelText(/打刻時刻/)).toBeNull();
    expect(screen.queryByRole("button", { name: "退勤" })).toBeNull();
  });

  test("再認証失敗時は旧打刻画面を隠してエラー状態を表示する", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({
      serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
    });
    mocks.createSession.mockResolvedValue({
      serverError: {
        code: "LINE_AUTH_FAILED",
        message: "LINE認証に失敗しました。",
      },
    });
    renderStaffPage(readyAuth, workingSnapshot());

    await user.click(screen.getByRole("button", { name: "退勤" }));

    expect(await screen.findByText("認証を確認できません")).toBeTruthy();
    expect(screen.getByText("LINE認証に失敗しました。")).toBeTruthy();
    expect(mocks.clock).toHaveBeenCalledOnce();
    expect(screen.queryByText("昼勤務中")).toBeNull();
    expect(screen.queryByLabelText(/打刻時刻/)).toBeNull();
  });

  test("同一主体の再認証は画面snapshotを保ち、打刻せず最新状態を再取得する", async () => {
    const user = userEvent.setup();
    mocks.clock
      .mockResolvedValueOnce({
        serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
      })
      .mockResolvedValueOnce({
        serverError: { code: "ACTION_FAILED", message: "再試行後の失敗" },
      });
    mocks.createSession.mockResolvedValue({ data: readyAuth.user });
    renderStaffPage(readyAuth, workingSnapshot());

    await user.click(screen.getByRole("button", { name: "退勤" }));

    await waitFor(() => expect(mocks.clock).toHaveBeenCalledOnce());
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.getByText("昼勤務中")).toBeTruthy();
    expect(
      await screen.findByText(/元の打刻は記録されていません/),
    ).toBeTruthy();
  });

  test("同時クリックは1回だけ実行しsession expiry後に打刻しない", async () => {
    mocks.clock
      .mockResolvedValueOnce({
        serverError: {
          code: "SESSION_EXPIRED",
          message: "ログイン状態が切れています。",
        },
      })
      .mockResolvedValueOnce({
        serverError: {
          code: "SESSION_EXPIRED",
          message: "ログイン状態が切れています。",
        },
      })
      .mockResolvedValue({ data: undefined });
    mocks.createSession.mockResolvedValue({ data: readyAuth.user });
    renderStaffPage();
    const clockIn = screen.getByRole("button", { name: "昼に出勤" });

    await act(async () => {
      clockIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      clockIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => expect(mocks.clock).toHaveBeenCalledOnce());
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  test("same-month current read failure retains the existing current snapshot", async () => {
    const user = userEvent.setup();
    const { rerender } = renderStaffPage();
    const clockIn = screen.getByRole("button", { name: "昼に出勤" });
    expect(clockIn).toHaveProperty("disabled", false);

    rerender(
      staffPageElement(readyAuth, {
        current: {
          status: "error",
          message: "現在の勤怠を取得できませんでした。",
        },
      }),
    );

    expect(
      screen.getByText("最新の勤務状態を取得できませんでした。"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "昼に出勤" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(screen.getByRole("button", { name: "昼に出勤" }));
    expect(mocks.clock).not.toHaveBeenCalled();

    rerender(staffPageElement(readyAuth, snapshot));

    expect(
      screen.queryByText("最新の勤務状態を取得できませんでした。"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "昼に出勤" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
