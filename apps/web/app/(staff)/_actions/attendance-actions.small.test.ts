import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ClockRejectedError extends Error {}
  class AlreadyWorkingError extends Error {}
  class NotWorkingError extends Error {}
  class ClockStaleError extends Error {}
  class TimeOverlapError extends Error {}
  return {
    application: { clock: vi.fn() },
    createApplication: vi.fn(),
    getServerReferenceTime: vi.fn(),
    resolveStaffAuthSession: vi.fn(),
    revalidatePath: vi.fn(),
    report: vi.fn(),
    ClockRejectedError,
    AlreadyWorkingError,
    NotWorkingError,
    ClockStaleError,
    TimeOverlapError,
  };
});

vi.mock("@repo/db", () => ({ getDatabase: vi.fn() }));
vi.mock("@repo/attendance", () => ({
  AttendanceClockAlreadyWorkingError: mocks.AlreadyWorkingError,
  AttendanceClockCommandRejectedError: mocks.ClockRejectedError,
  AttendanceClockNotWorkingError: mocks.NotWorkingError,
  AttendanceClockStaleError: mocks.ClockStaleError,
  AttendanceTimeOverlapError: mocks.TimeOverlapError,
}));
vi.mock("../../../lib/server/attendance-composition", () => ({
  createAttendanceApplication: mocks.createApplication,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../lib/server/auth-session", () => ({
  resolveStaffAuthSession: mocks.resolveStaffAuthSession,
}));
vi.mock("../../../lib/server-observability", () => ({
  reportUnexpectedServerException: mocks.report,
}));
vi.mock("../../../lib/server/reference-time", () => ({
  getServerReferenceTime: mocks.getServerReferenceTime,
}));

const staff = {
  userId: "staff-1",
  displayName: "スタッフ",
  role: "staff",
  status: "active",
};
const referenceTime = new Date("2026-09-17T03:00:00.000Z");
const attendanceId = "66666666-6666-4666-8666-666666666666";

afterEach(() => {
  mocks.application.clock.mockReset();
  mocks.createApplication.mockReset();
  mocks.getServerReferenceTime.mockReset();
  mocks.resolveStaffAuthSession.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.report.mockReset();
});

describe("staff attendance server actions", () => {
  test("strict validation rejects malformed and extra client fields without a mutation", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-08-22T09:00:00+09:00",
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_out",
        workPeriod: "day",
        occurredAt: "2026-08-22T09:00:00+09:00",
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_out",
        workPeriod: "day",
        time: "18:00",
        targetAttendanceId: attendanceId,
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_out",
        workPeriod: "day",
        time: "18:00",
        targetEventVersion: 1,
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-08-22T09:00:00+09:00",
        userId: "another-user",
        role: "admin",
        status: "active",
      }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    expect(mocks.resolveStaffAuthSession).not.toHaveBeenCalled();
    expect(mocks.application.clock).not.toHaveBeenCalled();
  });

  test("missing session does not invoke the application", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "missing",
      message: "ログインが必要です。",
    });
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_in",
        workPeriod: "day",
        time: "09:00",
      }),
    ).resolves.toEqual({
      success: false,
      code: "SESSION_EXPIRED",
      message: "ログイン状態が切れています。",
    });
    expect(mocks.application.clock).not.toHaveBeenCalled();
  });

  test("clock uses the authenticated actor and revalidates the staff page", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.getServerReferenceTime.mockReturnValue(referenceTime);
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockResolvedValue({ attendanceId: "attendance-1" });
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_in",
        workPeriod: "day",
        time: "09:00",
      }),
    ).resolves.toEqual({ success: true });
    expect(mocks.application.clock).toHaveBeenCalledWith(staff, {
      eventType: "clock_in",
      workPeriod: "day",
      time: "09:00",
    });
    expect(mocks.getServerReferenceTime).toHaveBeenCalledTimes(1);
    expect(mocks.createApplication.mock.calls[0]?.[0].now()).toBe(
      referenceTime,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clock");
  });

  test("already-working and not-working errors become user-facing state messages", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);

    mocks.application.clock.mockRejectedValue(new mocks.AlreadyWorkingError());
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_in",
        workPeriod: "day",
        time: "09:00",
      }),
    ).resolves.toEqual({
      success: false,
      message: "退勤していない勤務があります。先に退勤してください。",
    });

    mocks.application.clock.mockRejectedValue(new mocks.NotWorkingError());
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_out",
        workPeriod: "day",
        time: "18:00",
      }),
    ).resolves.toEqual({
      success: false,
      message: "出勤していないため、退勤できません。",
    });
  });

  test("clock-out contract forwards its target while clock-in remains unchanged", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const request = {
      eventType: "clock_out",
      workPeriod: "day",
      time: "18:00",
      targetAttendanceId: attendanceId,
      targetEventVersion: 1,
    } as const;
    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockResolvedValue({ attendanceId });
    await expect(clockStaffAttendanceAction(request)).resolves.toEqual({
      success: true,
    });
    expect(mocks.application.clock).toHaveBeenCalledWith(staff, request);
  });

  test("clock-out target は認証前にUUID検証し、有効なIDを変更せずapplicationへ渡す", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const request = {
      eventType: "clock_out",
      workPeriod: "day",
      time: "18:00",
      targetAttendanceId: "not-a-uuid",
      targetEventVersion: 1,
    } as const;
    await expect(clockStaffAttendanceAction(request)).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    expect(mocks.resolveStaffAuthSession).not.toHaveBeenCalled();
    expect(mocks.getServerReferenceTime).not.toHaveBeenCalled();
    expect(mocks.application.clock).not.toHaveBeenCalled();

    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockResolvedValue({ attendanceId });
    await expect(
      clockStaffAttendanceAction({
        ...request,
        targetAttendanceId: attendanceId,
      }),
    ).resolves.toEqual({ success: true });
    expect(mocks.application.clock).toHaveBeenCalledWith(staff, {
      ...request,
      targetAttendanceId: attendanceId,
    });
  });

  test("time overlap is returned with the client action code", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockRejectedValue(
      new mocks.TimeOverlapError("overlap"),
    );
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_in",
        workPeriod: "day",
        time: "09:00",
      }),
    ).resolves.toEqual({
      success: false,
      code: "ATTENDANCE_TIME_OVERLAP",
      message: "overlap",
    });
  });

  test("command rejection preserves the domain message", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockRejectedValue(
      new mocks.ClockRejectedError("clock rejected"),
    );
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_in",
        workPeriod: "day",
        time: "09:00",
      }),
    ).resolves.toEqual({ success: false, message: "clock rejected" });
  });

  test("clock stale is returned with the dedicated action code and message", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockRejectedValue(new mocks.ClockStaleError());
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_out",
        workPeriod: "day",
        time: "18:00",
        targetAttendanceId: attendanceId,
        targetEventVersion: 1,
      }),
    ).resolves.toEqual({
      success: false,
      code: "ATTENDANCE_CLOCK_STALE",
      message:
        "勤怠の状態が更新されています。最新の状態を確認してから、もう一度操作してください。",
    });
  });

  test("authentication resolver failure is a generic failure, not a reauthentication result", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "error",
      message: "認証状態を確認できませんでした。",
    });
    await expect(
      clockStaffAttendanceAction({
        eventType: "clock_in",
        workPeriod: "day",
        time: "09:00",
      }),
    ).resolves.toEqual({
      success: false,
      message: "打刻の保存に失敗しました。",
    });
    expect(mocks.application.clock).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  test("unexpected clock failures are observed and never expose session data", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const failure = new Error("database password");
    mocks.resolveStaffAuthSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockRejectedValue(failure);
    const result = await clockStaffAttendanceAction({
      eventType: "clock_in",
      workPeriod: "day",
      time: "09:00",
    });
    expect(result).toEqual({
      success: false,
      message: "打刻の保存に失敗しました。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "staff.attendance.action.clock",
    );
    expect(result).not.toHaveProperty("sessionId");
  });
});
