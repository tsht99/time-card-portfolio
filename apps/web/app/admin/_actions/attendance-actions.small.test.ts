import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class CorrectionConflict extends Error {}
  class CancellationConflict extends Error {}
  class Overlap extends Error {}
  class CorrectionRejected extends Error {}
  class CorrectionForbidden extends Error {}
  class CancellationRejected extends Error {}
  class CancellationForbidden extends Error {}
  class ManualCreationCommandRejected extends Error {}
  class ManualCreationForbidden extends Error {}
  class ManualCreationTargetNotFound extends Error {}
  class ManualCreationTargetNotApproved extends Error {}
  return {
    application: {
      getMonthlyPayrollSummary: vi.fn(),
      getUserMonthlyPayrollDetail: vi.fn(),
      correct: vi.fn(),
      cancel: vi.fn(),
      createAdminAttendance: vi.fn(),
    },
    createApplication: vi.fn(),
    resolve: vi.fn(),
    revalidatePath: vi.fn(),
    report: vi.fn(),
    loadAdminUserMonthlyPayrollDetail: vi.fn(),
    CorrectionConflict,
    CancellationConflict,
    Overlap,
    CorrectionRejected,
    CorrectionForbidden,
    CancellationRejected,
    CancellationForbidden,
    ManualCreationCommandRejected,
    ManualCreationForbidden,
    ManualCreationTargetNotFound,
    ManualCreationTargetNotApproved,
  };
});
vi.mock("@repo/db", () => ({ getDatabase: vi.fn() }));
vi.mock("@repo/attendance", () => ({
  AttendanceCorrectionVersionConflictError: mocks.CorrectionConflict,
  AttendanceCancellationVersionConflictError: mocks.CancellationConflict,
  AttendanceTimeOverlapError: mocks.Overlap,
  AttendanceCorrectionCommandRejectedError: mocks.CorrectionRejected,
  AttendanceCorrectionForbiddenError: mocks.CorrectionForbidden,
  AttendanceCancellationCommandRejectedError: mocks.CancellationRejected,
  AttendanceCancellationForbiddenError: mocks.CancellationForbidden,
  AttendanceManualCreationCommandRejectedError:
    mocks.ManualCreationCommandRejected,
  AttendanceManualCreationForbiddenError: mocks.ManualCreationForbidden,
  AttendanceManualCreationTargetNotFoundError:
    mocks.ManualCreationTargetNotFound,
  AttendanceManualCreationTargetNotApprovedError:
    mocks.ManualCreationTargetNotApproved,
}));
vi.mock("../../../lib/server/payroll-composition", () => ({
  createAdminPayrollQueries: mocks.createApplication,
}));
vi.mock("../../../lib/server/attendance-composition", () => ({
  createAttendanceApplication: mocks.createApplication,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("../../../lib/server/auth-session", () => ({
  resolveAdminAuthSession: mocks.resolve,
}));
vi.mock("../../../lib/server/admin-attendance", () => ({
  loadAdminUserMonthlyPayrollDetail: mocks.loadAdminUserMonthlyPayrollDetail,
}));
vi.mock("../../../lib/server-observability", () => ({
  reportUnexpectedServerException: mocks.report,
}));
const admin = {
  status: "ready",
  user: {
    userId: "admin-1",
    displayName: "管理者",
    role: "admin",
    status: "active",
  },
};
const attendanceId = "66666666-6666-4666-8666-666666666666";
afterEach(() => {
  mocks.application.getMonthlyPayrollSummary.mockReset();
  mocks.application.getUserMonthlyPayrollDetail.mockReset();
  mocks.application.correct.mockReset();
  mocks.application.cancel.mockReset();
  mocks.application.createAdminAttendance.mockReset();
  mocks.createApplication.mockReset();
  mocks.resolve.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.report.mockReset();
  mocks.loadAdminUserMonthlyPayrollDetail.mockReset();
});
describe("admin attendance actions", () => {
  test("給与詳細Actionはstrict parse後に認証済みloaderへ委譲する", async () => {
    const { getAdminUserMonthlyPayrollDetailAction } = await import(
      "./attendance-actions.ts"
    );
    const input = {
      userId: "11111111-1111-4111-8111-111111111111",
      month: "2026-08",
    };
    await expect(
      getAdminUserMonthlyPayrollDetailAction({ ...input, extra: true }),
    ).resolves.toEqual({
      status: "error",
      message: "リクエスト形式が正しくありません。",
    });
    expect(mocks.loadAdminUserMonthlyPayrollDetail).not.toHaveBeenCalled();
    const states = [
      { status: "ready", data: { totalEstimatedPayYen: 1000 } },
      { status: "missing", message: "対象ユーザーが見つかりません。" },
      { status: "unavailable", message: "権限なし" },
      { status: "error", message: "取得失敗" },
    ] as const;
    for (const state of states) {
      mocks.loadAdminUserMonthlyPayrollDetail.mockResolvedValueOnce(state);
      await expect(
        getAdminUserMonthlyPayrollDetailAction(input),
      ).resolves.toEqual(state);
    }
    expect(mocks.loadAdminUserMonthlyPayrollDetail).toHaveBeenCalledTimes(4);
    expect(mocks.loadAdminUserMonthlyPayrollDetail).toHaveBeenNthCalledWith(
      1,
      input.userId,
      input.month,
    );
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createApplication).not.toHaveBeenCalled();
  });

  test("strict input と missing / unavailable auth は application を実行しない", async () => {
    const { correctAdminAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    await expect(
      correctAdminAttendanceAction({
        attendanceId,
        changes: { expectedVersion: 1, workPeriod: "day" },
        role: "admin",
      }),
    ).resolves.toMatchObject({ success: false });
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue({
      status: "missing",
      message: "ログインが必要です。",
    });
    await expect(
      correctAdminAttendanceAction({
        attendanceId,
        changes: { expectedVersion: 1, workPeriod: "day" },
      }),
    ).resolves.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(mocks.application.correct).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
      message: "権限なし",
    });
    await expect(
      correctAdminAttendanceAction({
        attendanceId,
        changes: { expectedVersion: 1, workPeriod: "day" },
      }),
    ).resolves.toMatchObject({ code: "ADMIN_ACCESS_REQUIRED" });
  });

  test("管理者勤怠新規作成は strict parse、認証、通常application、revalidateを守る", async () => {
    const { createAdminAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const input = {
      userId: "staff-1",
      workPeriod: "night" as const,
      clockInAt: "2026-09-01T18:00:00+09:00",
      clockOutAt: "2026-09-01T23:00:00+09:00",
    };
    await expect(
      createAdminAttendanceAction({ ...input, extra: true }),
    ).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    await expect(
      createAdminAttendanceAction({ ...input, clockInAt: "bad" }),
    ).resolves.toMatchObject({ success: false });
    expect(mocks.resolve).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue({
      status: "missing",
      message: "ログインが必要です。",
    });
    await expect(createAdminAttendanceAction(input)).resolves.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    expect(mocks.application.createAdminAttendance).not.toHaveBeenCalled();
    mocks.resolve.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.createAdminAttendance.mockResolvedValue({
      attendanceId: "new-1",
    });
    await expect(createAdminAttendanceAction(input)).resolves.toEqual({
      success: true,
      attendanceId: "new-1",
    });
    expect(mocks.createApplication).toHaveBeenCalledWith({});
    expect(mocks.application.createAdminAttendance).toHaveBeenCalledWith(
      admin.user,
      input,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/attendance");
  });

  test("管理者勤怠新規作成は出退勤の秒・ミリ秒を拒否し、分境界はそのまま渡す", async () => {
    const { createAdminAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const input = {
      userId: "staff-1",
      workPeriod: "day" as const,
      clockInAt: "2026-09-01T09:00:00+09:00",
      clockOutAt: "2026-09-01T18:00:00+09:00",
    };
    mocks.resolve.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue(mocks.application);
    for (const field of ["clockInAt", "clockOutAt"] as const) {
      for (const value of [
        "2026-09-01T09:00:01+09:00",
        "2026-09-01T09:00:00.001+09:00",
      ]) {
        await expect(
          createAdminAttendanceAction({ ...input, [field]: value }),
        ).resolves.toEqual({
          success: false,
          message: "リクエスト形式が正しくありません。",
        });
      }
    }
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createApplication).not.toHaveBeenCalled();
    expect(mocks.application.createAdminAttendance).not.toHaveBeenCalled();
    mocks.application.createAdminAttendance.mockResolvedValue({
      attendanceId: "new-1",
    });
    await expect(createAdminAttendanceAction(input)).resolves.toEqual({
      success: true,
      attendanceId: "new-1",
    });
    expect(mocks.application.createAdminAttendance).toHaveBeenCalledWith(
      admin.user,
      input,
    );
  });

  test("管理者勤怠訂正は出退勤の秒・ミリ秒を拒否し、分境界はそのまま渡す", async () => {
    const { correctAdminAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const input = {
      attendanceId,
      changes: {
        expectedVersion: 1,
        clockInAt: "2026-09-01T09:00:00+09:00",
        clockOutAt: "2026-09-01T18:00:00+09:00",
      },
    };
    mocks.resolve.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue(mocks.application);
    for (const field of ["clockInAt", "clockOutAt"] as const) {
      for (const value of [
        "2026-09-01T09:00:01+09:00",
        "2026-09-01T09:00:00.001+09:00",
      ]) {
        await expect(
          correctAdminAttendanceAction({
            ...input,
            changes: { ...input.changes, [field]: value },
          }),
        ).resolves.toEqual({
          success: false,
          message: "リクエスト形式が正しくありません。",
        });
      }
    }
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createApplication).not.toHaveBeenCalled();
    expect(mocks.application.correct).not.toHaveBeenCalled();
    mocks.application.correct.mockResolvedValue({ attendanceId });
    await expect(correctAdminAttendanceAction(input)).resolves.toEqual({
      success: true,
      attendanceId,
    });
    expect(mocks.application.correct).toHaveBeenCalledWith(
      admin.user,
      input.attendanceId,
      input.changes,
    );
  });

  test("訂正・取消の不正勤怠IDは認証前に拒否する", async () => {
    const { cancelAdminAttendanceAction, correctAdminAttendanceAction } =
      await import("./attendance-actions.ts");
    const correction = {
      attendanceId: "not-a-uuid",
      changes: { expectedVersion: 3, workPeriod: "day" },
    };
    const cancellation = { attendanceId: "not-a-uuid", expectedVersion: 3 };
    await expect(correctAdminAttendanceAction(correction)).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    await expect(cancelAdminAttendanceAction(cancellation)).resolves.toEqual({
      success: false,
      message: "リクエスト形式が正しくありません。",
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createApplication).not.toHaveBeenCalled();
    expect(mocks.application.correct).not.toHaveBeenCalled();
    expect(mocks.application.cancel).not.toHaveBeenCalled();
  });

  test("管理者勤怠新規作成の既知・予期しないエラーを固定メッセージへ変換する", async () => {
    const { createAdminAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    const input = {
      userId: "staff-1",
      workPeriod: "day" as const,
      clockInAt: "2026-09-01T09:00:00+09:00",
      clockOutAt: "2026-09-01T18:00:00+09:00",
    };
    mocks.resolve.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue(mocks.application);
    const cases = [
      [
        mocks.ManualCreationTargetNotFound,
        "対象ユーザーが見つかりません。最新のユーザー一覧を確認してください。",
      ],
      [
        mocks.ManualCreationTargetNotApproved,
        "利用承認待ちのユーザーには勤怠を新規作成できません。",
      ],
      [mocks.ManualCreationForbidden, "勤怠を新規作成する権限がありません。"],
      [
        mocks.ManualCreationCommandRejected,
        "勤怠を新規作成できませんでした。入力日時と既存の勤怠を確認してください。",
      ],
    ] as const;
    for (const [ErrorType, message] of cases) {
      mocks.application.createAdminAttendance.mockRejectedValueOnce(
        new ErrorType(),
      );
      await expect(createAdminAttendanceAction(input)).resolves.toEqual({
        success: false,
        message,
      });
    }
    mocks.application.createAdminAttendance.mockRejectedValueOnce(
      new mocks.Overlap("重複"),
    );
    await expect(createAdminAttendanceAction(input)).resolves.toEqual({
      success: false,
      code: "ATTENDANCE_TIME_OVERLAP",
      message: "重複",
    });
    const unexpected = new Error("db");
    mocks.application.createAdminAttendance.mockRejectedValueOnce(unexpected);
    await expect(createAdminAttendanceAction(input)).resolves.toEqual({
      success: false,
      message: "勤怠の新規作成に失敗しました。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      unexpected,
      "admin.attendance.action.create",
    );
  });

  test("correct/cancel は server actor と version を使い、成功時に revalidate する", async () => {
    const { cancelAdminAttendanceAction, correctAdminAttendanceAction } =
      await import("./attendance-actions.ts");
    mocks.resolve.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.correct.mockResolvedValue({ attendanceId });
    mocks.application.cancel.mockResolvedValue({ attendanceId });
    await correctAdminAttendanceAction({
      attendanceId,
      changes: { expectedVersion: 3, workPeriod: "day" },
    });
    await cancelAdminAttendanceAction({
      attendanceId,
      expectedVersion: 4,
    });
    expect(mocks.application.correct).toHaveBeenCalledWith(
      admin.user,
      attendanceId,
      {
        expectedVersion: 3,
        workPeriod: "day",
      },
    );
    expect(mocks.application.cancel).toHaveBeenCalledWith(
      admin.user,
      attendanceId,
      {
        expectedVersion: 4,
      },
    );
    expect(mocks.createApplication).toHaveBeenCalledTimes(2);
    expect(mocks.createApplication).toHaveBeenNthCalledWith(1, {});
    expect(mocks.createApplication).toHaveBeenNthCalledWith(2, {});
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(
      1,
      "/admin/attendance",
    );
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(
      2,
      `/admin/attendance/${attendanceId}`,
    );
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(
      3,
      "/admin/attendance",
    );
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(
      4,
      `/admin/attendance/${attendanceId}`,
    );
  });

  test("application errors map to transport-independent codes and fixed reporting", async () => {
    const { correctAdminAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolve.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue(mocks.application);
    mocks.application.correct.mockRejectedValue(new mocks.Overlap("overlap"));
    await expect(
      correctAdminAttendanceAction({
        attendanceId,
        changes: { expectedVersion: 1, workPeriod: "day" },
      }),
    ).resolves.toMatchObject({ code: "ATTENDANCE_TIME_OVERLAP" });
  });

  test("auth resolver の error は generic failure のままで application を実行しない", async () => {
    const { correctAdminAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolve.mockResolvedValue({
      status: "error",
      message: "認証情報を確認できませんでした。",
    });
    await expect(
      correctAdminAttendanceAction({
        attendanceId,
        changes: { expectedVersion: 1, workPeriod: "day" },
      }),
    ).resolves.toEqual({
      success: false,
      message: "認証情報を確認できませんでした。",
    });
    expect(mocks.application.correct).not.toHaveBeenCalled();
  });

  test("correction の application error をそれぞれ契約どおり返す", async () => {
    const { correctAdminAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolve.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue(mocks.application);
    const input = {
      attendanceId,
      changes: { expectedVersion: 1, workPeriod: "day" as const },
    };
    mocks.application.correct.mockRejectedValue(
      new mocks.CorrectionConflict("stale"),
    );
    await expect(correctAdminAttendanceAction(input)).resolves.toMatchObject({
      code: "ATTENDANCE_VERSION_CONFLICT",
    });
    mocks.application.correct.mockRejectedValue(
      new mocks.CorrectionRejected("rejected"),
    );
    await expect(correctAdminAttendanceAction(input)).resolves.toEqual({
      success: false,
      message: "rejected",
    });
    mocks.application.correct.mockRejectedValue(
      new mocks.CorrectionForbidden("forbidden"),
    );
    await expect(correctAdminAttendanceAction(input)).resolves.toEqual({
      success: false,
      message: "forbidden",
    });
    const failure = new Error("db");
    mocks.application.correct.mockRejectedValue(failure);
    await expect(correctAdminAttendanceAction(input)).resolves.toEqual({
      success: false,
      message: "勤怠の訂正に失敗しました。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "admin.attendance.action.correct",
    );
  });

  test("cancellation の application error を契約どおり返す", async () => {
    const { cancelAdminAttendanceAction } = await import(
      "./attendance-actions.ts"
    );
    mocks.resolve.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue(mocks.application);
    const cancellation = {
      attendanceId,
      expectedVersion: 1,
    };
    mocks.application.cancel.mockRejectedValue(
      new mocks.CancellationConflict("stale"),
    );
    await expect(
      cancelAdminAttendanceAction(cancellation),
    ).resolves.toMatchObject({ code: "ATTENDANCE_VERSION_CONFLICT" });
    mocks.application.cancel.mockRejectedValue(
      new mocks.CancellationRejected("rejected"),
    );
    await expect(cancelAdminAttendanceAction(cancellation)).resolves.toEqual({
      success: false,
      message: "rejected",
    });
    mocks.application.cancel.mockRejectedValue(
      new mocks.CancellationForbidden("forbidden"),
    );
    await expect(cancelAdminAttendanceAction(cancellation)).resolves.toEqual({
      success: false,
      message: "forbidden",
    });
    const cancellationFailure = new Error("db");
    mocks.application.cancel.mockRejectedValue(cancellationFailure);
    await expect(cancelAdminAttendanceAction(cancellation)).resolves.toEqual({
      success: false,
      message: "勤怠の取消に失敗しました。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      cancellationFailure,
      "admin.attendance.action.cancel",
    );
  });
});
