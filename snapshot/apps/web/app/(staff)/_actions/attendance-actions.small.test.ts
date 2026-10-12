import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class ClockRejectedError extends Error {}
  class ProcessingDateMismatchError extends Error {}
  class AlreadyWorkingError extends Error {}
  class ClockStaleError extends Error {}
  class TimeOverlapError extends Error {}
  class AccessForbiddenError extends Error {}
  return {
    application: { clock: vi.fn() },
    createApplication: vi.fn(),
    getServerReferenceTime: vi.fn(),
    resolveAuthenticatedUserSession: vi.fn(),
    revalidatePath: vi.fn(),
    report: vi.fn(),
    ClockRejectedError,
    ProcessingDateMismatchError,
    AlreadyWorkingError,
    ClockStaleError,
    TimeOverlapError,
    AccessForbiddenError,
  };
});

vi.mock("@repo/db", () => ({ getDatabase: vi.fn() }));
vi.mock("@repo/attendance", () => ({
  AttendanceAccessForbiddenError: mocks.AccessForbiddenError,
  AttendanceClockProcessingDateMismatchError: mocks.ProcessingDateMismatchError,
  AttendanceClockAlreadyWorkingError: mocks.AlreadyWorkingError,
  AttendanceClockCommandRejectedError: mocks.ClockRejectedError,
  AttendanceClockStaleError: mocks.ClockStaleError,
  AttendanceTimeOverlapError: mocks.TimeOverlapError,
}));
vi.mock("../../../lib/server/attendance-composition", () => ({
  createTimeCardAttendanceApplication: mocks.createApplication,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../lib/server/auth-session", () => ({
  resolveAuthenticatedUserSession: mocks.resolveAuthenticatedUserSession,
}));
vi.mock("../../../lib/server/server-observability", () => ({
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
  mocks.resolveAuthenticatedUserSession.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.report.mockReset();
});

async function callAction(action: unknown, input: unknown) {
  if (typeof action !== "function")
    throw new TypeError("Expected action function");
  return action(input);
}

describe("staff attendance server actions", () => {
  test("strict validation rejects malformed and extra client fields without a mutation", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_in",
        workPeriod: "day",
        time: "09:00",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ validationErrors: expect.anything() }),
    );
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_out",
        workPeriod: "day",
        time: "09:00",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ validationErrors: expect.anything() }),
    );
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_out",
        workPeriod: "day",
        occurredAt: "2026-09-17T18:00:00+09:00",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ validationErrors: expect.anything() }),
    );
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_out",
        workPeriod: "day",
        occurredAt: "2026-09-17T18:00:00+09:00",
        targetAttendanceId: attendanceId,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ validationErrors: expect.anything() }),
    );
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_out",
        workPeriod: "day",
        occurredAt: "2026-09-17T18:00:00+09:00",
        targetEventVersion: 1,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ validationErrors: expect.anything() }),
    );
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-08-22T09:00:00+09:00",
        userId: "another-user",
        role: "admin",
        status: "active",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ validationErrors: expect.anything() }),
    );
    expect(mocks.resolveAuthenticatedUserSession).not.toHaveBeenCalled();
    expect(mocks.application.clock).not.toHaveBeenCalled();
  });

  test("missing session does not invoke the application", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "missing",
      message: "ログインが必要です。",
    });
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-09-17T09:00:00+09:00",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      },
    });
    expect(mocks.application.clock).not.toHaveBeenCalled();
  });

  test("clock uses the authenticated actor and revalidates the staff page", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.getServerReferenceTime.mockReturnValue(referenceTime);
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockResolvedValue({ attendanceId: "attendance-1" });
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-09-17T09:00:00+09:00",
      }),
    ).resolves.toEqual({ data: undefined });
    expect(mocks.application.clock).toHaveBeenCalledWith(
      { userId: staff.userId },
      {
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-09-17T09:00:00+09:00",
      },
    );
    expect(
      mocks.resolveAuthenticatedUserSession.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.application.clock.mock.invocationCallOrder[0]);
    expect(mocks.getServerReferenceTime).toHaveBeenCalledTimes(1);
    expect(mocks.createApplication.mock.calls[0]?.[0].now()).toBe(
      referenceTime,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clock");
  });

  test("already-working errors become user-facing state messages", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);

    mocks.application.clock.mockRejectedValue(new mocks.AlreadyWorkingError());
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-09-17T09:00:00+09:00",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "ATTENDANCE_ALREADY_WORKING",
        message: "退勤していない勤務があります。先に退勤してください。",
      },
    });

    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "missing",
    });
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_out",
        workPeriod: "day",
        occurredAt: "2026-09-17T18:00:00+09:00",
        targetAttendanceId: attendanceId,
        targetEventVersion: 1,
      }),
    ).resolves.toEqual({
      serverError: {
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      },
    });
  });

  test("processing-date mismatch asks staff to reload and preserves the typed error", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockRejectedValue(
      new mocks.ProcessingDateMismatchError(),
    );

    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-09-17T09:00:00+09:00",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "ATTENDANCE_PROCESSING_DATE_MISMATCH",
        message:
          "打刻対象日が更新されています。画面を再読み込みして、最新の日時で打刻してください。",
      },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  test("clock-out contract forwards its target while clock-in remains unchanged", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const request = {
      eventType: "clock_out",
      workPeriod: "day",
      occurredAt: "2026-09-17T18:00:00+09:00",
      targetAttendanceId: attendanceId,
      targetEventVersion: 1,
    } as const;
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockResolvedValue({ attendanceId });
    await expect(
      callAction(clockStaffAttendanceAction, request),
    ).resolves.toEqual({
      data: undefined,
    });
    expect(mocks.application.clock).toHaveBeenCalledWith(
      { userId: staff.userId },
      request,
    );
  });

  test("clock-out target は認証前にUUID検証し、有効なIDを変更せずapplicationへ渡す", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const request = {
      eventType: "clock_out",
      workPeriod: "day",
      occurredAt: "2026-09-17T18:00:00+09:00",
      targetAttendanceId: "not-a-uuid",
      targetEventVersion: 1,
    } as const;
    await expect(
      callAction(clockStaffAttendanceAction, request),
    ).resolves.toEqual(
      expect.objectContaining({ validationErrors: expect.anything() }),
    );
    expect(mocks.resolveAuthenticatedUserSession).not.toHaveBeenCalled();
    expect(mocks.getServerReferenceTime).not.toHaveBeenCalled();
    expect(mocks.application.clock).not.toHaveBeenCalled();

    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockResolvedValue({ attendanceId });
    await expect(
      callAction(clockStaffAttendanceAction, {
        ...request,
        targetAttendanceId: attendanceId,
      }),
    ).resolves.toEqual({ data: undefined });
    expect(mocks.application.clock).toHaveBeenCalledWith(
      { userId: staff.userId },
      {
        ...request,
        targetAttendanceId: attendanceId,
      },
    );
  });

  test("time overlap is returned with the client action code", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockRejectedValue(
      new mocks.TimeOverlapError("overlap"),
    );
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-09-17T09:00:00+09:00",
      }),
    ).resolves.toEqual({
      serverError: { code: "ATTENDANCE_TIME_OVERLAP", message: "overlap" },
    });
  });

  test("command rejection preserves the domain message", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockRejectedValue(
      new mocks.ClockRejectedError("clock rejected"),
    );
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-09-17T09:00:00+09:00",
      }),
    ).resolves.toEqual({
      serverError: { code: "ACTION_FAILED", message: "clock rejected" },
    });
  });

  test("clock stale is returned with the dedicated action code and message", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockRejectedValue(new mocks.ClockStaleError());
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_out",
        workPeriod: "day",
        occurredAt: "2026-09-17T18:00:00+09:00",
        targetAttendanceId: attendanceId,
        targetEventVersion: 1,
      }),
    ).resolves.toEqual({
      serverError: {
        code: "ATTENDANCE_CLOCK_STALE",
        message:
          "勤怠の状態が更新されています。最新の状態を確認してから、もう一度操作してください。",
      },
    });
  });

  test("authentication resolver failure is a generic failure, not a reauthentication result", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "error",
      message: "認証状態を確認できませんでした。",
    });
    await expect(
      callAction(clockStaffAttendanceAction, {
        eventType: "clock_in",
        workPeriod: "day",
        occurredAt: "2026-09-17T09:00:00+09:00",
      }),
    ).resolves.toEqual({
      serverError: {
        code: "ACTION_FAILED",
        message: "打刻の保存に失敗しました。",
      },
    });
    expect(mocks.application.clock).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  test("unexpected clock failures are observed and never expose session data", async () => {
    const { clockStaffAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const failure = new Error("database password");
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: staff,
    });
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.clock.mockRejectedValue(failure);
    const result = await callAction(clockStaffAttendanceAction, {
      eventType: "clock_in",
      workPeriod: "day",
      occurredAt: "2026-09-17T09:00:00+09:00",
    });
    expect(result).toEqual({
      serverError: {
        code: "INTERNAL_SERVER_ERROR",
        message: "打刻の保存に失敗しました。",
      },
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "staff.attendance.action.clock",
    );
    expect(result).not.toHaveProperty("sessionId");
  });
});
