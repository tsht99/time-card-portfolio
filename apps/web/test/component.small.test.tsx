import type { StaffAttendanceItem } from "@repo/contracts";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { StaffPage } from "../app/(staff)/_components/staff-page.tsx";
import { StaffQueryProvider as Providers } from "../app/(staff)/_components/staff-query-provider.tsx";
import type { AuthBootstrapState } from "../lib/auth-types";
import type { StaffCurrentAttendanceReadState } from "../lib/staff-attendance-types";

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

vi.mock("../env", () => ({
  env: { NEXT_PUBLIC_LIFF_ID: "test-liff-id" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));
vi.mock("@line/liff", () => ({ default: mocks.liff }));
vi.mock("../app/(staff)/_actions/auth-actions.ts", () => ({
  createStaffLineSessionAction: mocks.createSession,
}));
vi.mock("../app/(staff)/_actions/attendance-actions.ts", () => ({
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

function staffAttendanceProps(
  initialAttendance: StaffAttendanceFixture | null,
) {
  return { initialCurrentAttendance: initialAttendance?.current ?? null };
}

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
  return render(
    <Providers>
      <StaffPage
        initialAuth={initialAuth}
        initialCurrentAttendance={initialAttendance?.current ?? null}
      />
    </Providers>,
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
    mocks.createSession.mockResolvedValue({
      success: true,
      user: readyAuth.user,
    });
    renderStaffPage(missingAuth);

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());

    expect(mocks.createSession).toHaveBeenCalled();
    expect(mocks.liff.init).toHaveBeenCalled();
    expect(mocks.clock).not.toHaveBeenCalled();
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
    mocks.clock.mockResolvedValue({ success: true });
    renderStaffPage(readyAuth, workingSnapshot());
    const time = screen.getByLabelText("打刻時刻");
    await user.clear(time);
    await user.type(time, "22:10");
    await user.click(screen.getByRole("button", { name: "退勤" }));
    await waitFor(() =>
      expect(mocks.clock).toHaveBeenCalledWith({
        eventType: "clock_out",
        workPeriod: "day",
        time: "22:10",
        targetAttendanceId: "working-1",
        targetEventVersion: 1,
      }),
    );
    await waitFor(() =>
      expect(mocks.clock).toHaveBeenCalledWith({
        eventType: "clock_out",
        workPeriod: "day",
        time: "22:10",
        targetAttendanceId: "working-1",
        targetEventVersion: 1,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("clock action uses the Server Action and refreshes server data", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({ success: true });
    renderStaffPage();

    const time = screen.getByLabelText("打刻時刻");
    await user.clear(time);
    await user.type(time, "09:00");
    await user.click(screen.getByRole("button", { name: "昼に出勤" }));
    await waitFor(() => expect(mocks.clock).toHaveBeenCalledTimes(1));
    expect(mocks.clock).toHaveBeenCalledWith({
      eventType: "clock_in",
      workPeriod: "day",
      time: "09:00",
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  test("同日の完了済み勤怠があっても通常clock-inとして送信する", async () => {
    const user = userEvent.setup();
    const date = currentTokyoDate();
    mocks.clock.mockResolvedValue({ success: true });
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

  test("clock staleは最新snapshotをrefreshし、別Attendanceへ再送しない", async () => {
    const user = userEvent.setup();
    mocks.clock.mockResolvedValue({
      success: false,
      code: "ATTENDANCE_CLOCK_STALE",
      message:
        "勤怠の状態が更新されています。最新の状態を確認してから、もう一度操作してください。",
    });
    renderStaffPage(readyAuth, workingSnapshot());

    await user.click(screen.getByRole("button", { name: "退勤" }));

    await waitFor(() => expect(mocks.clock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.clock).toHaveBeenCalledWith({
      eventType: "clock_out",
      workPeriod: "day",
      time: expect.any(String),
      targetAttendanceId: "working-1",
      targetEventVersion: 1,
    });
    expect(
      screen.getByText("最新の状態を確認してから、もう一度操作してください", {
        exact: false,
      }),
    ).toBeTruthy();
  });

  test("session expiry reauthenticates once and retries the action once", async () => {
    const user = userEvent.setup();
    mocks.clock
      .mockResolvedValueOnce({
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      })
      .mockResolvedValueOnce({ success: true });
    mocks.createSession.mockResolvedValue({
      success: true,
      user: readyAuth.user,
    });
    renderStaffPage();

    const time = screen.getByLabelText("打刻時刻");
    await user.clear(time);
    await user.type(time, "09:00");

    await user.click(screen.getByRole("button", { name: "昼に出勤" }));
    await waitFor(() => expect(mocks.clock).toHaveBeenCalledTimes(2));
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(mocks.clock.mock.calls[1]?.[0]).toEqual(
      mocks.clock.mock.calls[0]?.[0],
    );
  });

  test("同時のsession expiryはLIFF再認証を1本にcoalesceして各Actionを1回だけretryする", async () => {
    mocks.clock
      .mockResolvedValueOnce({
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      })
      .mockResolvedValueOnce({
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      })
      .mockResolvedValue({ success: true });
    mocks.createSession.mockResolvedValue({
      success: true,
      user: readyAuth.user,
    });
    renderStaffPage();
    const clockIn = screen.getByRole("button", { name: "昼に出勤" });

    await act(async () => {
      clockIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      clockIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() => expect(mocks.clock).toHaveBeenCalledTimes(4));
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  test("same-month current read failure retains the existing current snapshot", async () => {
    const user = userEvent.setup();
    const { rerender } = renderStaffPage();
    const clockIn = screen.getByRole("button", { name: "昼に出勤" });
    expect(clockIn).toHaveProperty("disabled", false);

    rerender(
      <Providers>
        <StaffPage
          initialAuth={readyAuth}
          {...staffAttendanceProps({
            current: {
              status: "error",
              message: "現在の勤怠を取得できませんでした。",
            },
          })}
        />
      </Providers>,
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

    rerender(
      <Providers>
        <StaffPage
          initialAuth={readyAuth}
          {...staffAttendanceProps(snapshot)}
        />
      </Providers>,
    );

    expect(
      screen.queryByText("最新の勤務状態を取得できませんでした。"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "昼に出勤" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});
