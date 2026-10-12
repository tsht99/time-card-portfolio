import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  AttendanceEventStreamNotFoundError: class extends Error {},
  AttendanceAccessForbiddenError: class extends Error {},
  PayrollEstimateForbiddenError: class extends Error {
    constructor(readonly code = "TARGET_FORBIDDEN") {
      super("forbidden");
    }
  },
  getAdminAttendance: vi.fn(),
  getAdminAttendanceDetailWithPayrollEstimate: vi.fn(),
  createAdminPayrollEstimateQueries: vi.fn(),
  createApplication: vi.fn(),
  resolveAuthenticatedUserSession: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@repo/db", () => ({ getDatabase: vi.fn() }));
vi.mock("../../../../lib/server/attendance-composition", () => ({
  AttendanceEventStreamNotFoundError: mocks.AttendanceEventStreamNotFoundError,
  createTimeCardAttendanceApplication: mocks.createApplication,
}));
vi.mock("@repo/attendance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/attendance")>();
  return {
    ...actual,
    AttendanceEventStreamNotFoundError:
      mocks.AttendanceEventStreamNotFoundError,
    AttendanceAccessForbiddenError: mocks.AttendanceAccessForbiddenError,
  };
});
vi.mock("../../../../lib/server/payroll-composition", () => ({
  PayrollEstimateForbiddenError: mocks.PayrollEstimateForbiddenError,
  createAdminPayrollEstimateQueries: mocks.createAdminPayrollEstimateQueries,
}));
vi.mock("../../../../lib/server/auth-session", () => ({
  resolveAuthenticatedUserSession: mocks.resolveAuthenticatedUserSession,
}));
vi.mock("../../../../lib/server/server-observability", () => ({
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
const filters = {
  startAttendanceDateInclusive: "2026-08-01",
  endAttendanceDateInclusive: "2026-08-31",
  userId: "",
  workPeriod: "",
  status: "",
} as const;
const attendanceId = "66666666-6666-4666-8666-666666666666";
const result = {
  attendances: [
    {
      attendanceId: "attendance-1",
      eventVersion: 2,
      attendanceDate: "2026-08-10",
      userId: "staff-1",
      workPeriod: "day" as const,
      clockInAt: "2026-08-10T00:00:00.000Z",
      clockOutAt: "2026-08-10T09:00:00.000Z",
      workedMinutes: 540,
      status: "completed" as const,
    },
  ],
  cancelledAttendances: [
    {
      attendanceId: "attendance-1",
      attendanceDate: "2026-08-10",
      userId: "staff-1",
      workPeriod: "day" as const,
      clockInAt: "2026-08-10T00:00:00.000Z",
    },
  ],
};

afterEach(() =>
  Object.values(mocks).forEach((mock) => {
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  }),
);

describe("admin attendance server reads", () => {
  test("詳細は payroll query を一度だけ呼び、ready state を返す", async () => {
    const { loadAdminAttendanceDetail } = await import("./admin-attendance");
    const detail = { attendanceId, history: [] };
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createAdminPayrollEstimateQueries.mockReturnValue({
      getAdminAttendanceDetailWithPayrollEstimate:
        mocks.getAdminAttendanceDetailWithPayrollEstimate,
    });
    mocks.getAdminAttendanceDetailWithPayrollEstimate.mockResolvedValue(detail);
    await expect(loadAdminAttendanceDetail(attendanceId)).resolves.toEqual({
      status: "ready",
      data: detail,
    });
    expect(
      mocks.getAdminAttendanceDetailWithPayrollEstimate,
    ).toHaveBeenCalledTimes(1);
    expect(
      mocks.getAdminAttendanceDetailWithPayrollEstimate,
    ).toHaveBeenCalledWith({ userId: admin.user.userId }, attendanceId);
  });

  test("UUIDでない詳細IDは認証前に拒否する", async () => {
    const { loadAdminAttendanceDetail } = await import("./admin-attendance");
    await expect(loadAdminAttendanceDetail("not-a-uuid")).resolves.toEqual({
      status: "error",
      message: "勤怠詳細を取得できませんでした。",
    });
    expect(mocks.resolveAuthenticatedUserSession).not.toHaveBeenCalled();
    expect(mocks.createAdminPayrollEstimateQueries).not.toHaveBeenCalled();
  });

  test("詳細の権限拒否とmissing streamの応答を保持する", async () => {
    const { loadAdminAttendanceDetail } = await import("./admin-attendance");
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createAdminPayrollEstimateQueries.mockReturnValue({
      getAdminAttendanceDetailWithPayrollEstimate:
        mocks.getAdminAttendanceDetailWithPayrollEstimate,
    });
    mocks.getAdminAttendanceDetailWithPayrollEstimate.mockRejectedValueOnce(
      new mocks.AttendanceAccessForbiddenError(),
    );
    await expect(
      loadAdminAttendanceDetail(attendanceId),
    ).resolves.toMatchObject({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
    });
    mocks.getAdminAttendanceDetailWithPayrollEstimate.mockRejectedValueOnce(
      new mocks.AttendanceEventStreamNotFoundError(),
    );
    await expect(loadAdminAttendanceDetail(attendanceId)).resolves.toEqual({
      status: "missing",
      message: "勤怠が見つかりません。",
    });
  });

  test("一覧は統合 use case を一度だけ呼び、一覧と取消を返す", async () => {
    const { loadAdminAttendance } = await import("./admin-attendance");
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminAttendance: mocks.getAdminAttendance,
    });
    mocks.getAdminAttendance.mockResolvedValue(result);
    await expect(
      loadAdminAttendance({ ...filters, status: "cancelled" }),
    ).resolves.toEqual({ status: "ready", data: result });
    expect(mocks.getAdminAttendance).toHaveBeenCalledTimes(1);
    expect(mocks.getAdminAttendance).toHaveBeenCalledWith(
      { userId: "admin-1" },
      {
        startAttendanceDateInclusive: filters.startAttendanceDateInclusive,
        endAttendanceDateInclusive: filters.endAttendanceDateInclusive,
      },
    );
  });

  test("WebはApplication DTOを保ちuserIdから表示名だけを付与する", async () => {
    const { mapAdminAttendanceRows } = await import("./admin-attendance");
    expect(
      mapAdminAttendanceRows(result, [
        { userId: "staff-1", displayName: "山田" },
      ]),
    ).toEqual({
      attendance: [
        {
          attendanceId: "attendance-1",
          eventVersion: 2,
          attendanceDate: "2026-08-10",
          userId: "staff-1",
          displayName: "山田",
          workPeriod: "day",
          clockInAt: "2026-08-10T00:00:00.000Z",
          clockOutAt: "2026-08-10T09:00:00.000Z",
          workedMinutes: 540,
          status: "completed",
        },
      ],
      cancelledAttendance: [
        {
          attendanceId: "attendance-1",
          attendanceDate: "2026-08-10",
          userId: "staff-1",
          displayName: "山田",
          workPeriod: "day",
          clockInAt: "2026-08-10T00:00:00.000Z",
        },
      ],
    });
  });

  test("認証失敗は統合勤怠 application を呼ばない", async () => {
    const { loadAdminAttendance } = await import("./admin-attendance");
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "error",
      message: "認証情報を確認できませんでした。",
    });
    await expect(loadAdminAttendance(filters)).resolves.toEqual({
      status: "error",
      message: "認証情報を確認できませんでした。",
    });
    expect(mocks.getAdminAttendance).not.toHaveBeenCalled();
  });

  test("勤怠一覧のunexpected failureは固定messageとoperationになる", async () => {
    const { loadAdminAttendance } = await import("./admin-attendance");
    const failure = new Error("db");
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminAttendance: mocks.getAdminAttendance,
    });
    mocks.getAdminAttendance.mockRejectedValue(failure);
    await expect(loadAdminAttendance(filters)).resolves.toEqual({
      status: "error",
      message: "勤怠一覧を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "admin.attendance.read.list",
    );
  });
});
