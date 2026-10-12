import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  AttendanceEventStreamNotFoundError: class extends Error {},
  PayrollEstimateTargetUserNotFoundError: class extends Error {},
  PayrollEstimateForbiddenError: class extends Error {
    constructor(readonly code = "TARGET_FORBIDDEN") {
      super("forbidden");
    }
  },
  getAdminAttendanceDetailWithPayrollEstimate: vi.fn(),
  getUserMonthlyPayrollEstimateDetail: vi.fn(),
  getMonthlyPayrollEstimateSummary: vi.fn(),
  createApplication: vi.fn(),
  resolveAuthenticatedUserSession: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@repo/db", () => ({ getDatabase: vi.fn() }));
vi.mock("../../../lib/server/attendance-composition", () => ({
  AttendanceEventStreamNotFoundError: mocks.AttendanceEventStreamNotFoundError,
  PayrollEstimateTargetUserNotFoundError:
    mocks.PayrollEstimateTargetUserNotFoundError,
  createTimeCardAttendanceApplication: mocks.createApplication,
}));
vi.mock("@repo/attendance", () => ({
  AttendanceEventStreamNotFoundError: mocks.AttendanceEventStreamNotFoundError,
}));
vi.mock("@repo/payroll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/payroll")>()),
  PayrollEstimateForbiddenError: mocks.PayrollEstimateForbiddenError,
}));
vi.mock("../../../lib/server/payroll-composition", () => ({
  PayrollEstimateForbiddenError: mocks.PayrollEstimateForbiddenError,
  createAdminPayrollEstimateQueries: mocks.createApplication,
  isPayrollEstimateTargetUserNotFoundError: (error: unknown) =>
    error instanceof mocks.PayrollEstimateTargetUserNotFoundError,
}));
vi.mock("../../../lib/server/auth-session", () => ({
  resolveAuthenticatedUserSession: mocks.resolveAuthenticatedUserSession,
}));
vi.mock("../../../lib/server/server-observability", () => ({
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

afterEach(() =>
  Object.values(mocks).forEach((mock) => {
    if (
      typeof mock === "function" &&
      "mockReset" in mock &&
      typeof mock.mockReset === "function"
    ) {
      mock.mockReset();
    }
  }),
);

describe("admin payroll server reads", () => {
  test("monthly failure は固定 operation と generic message になる", async () => {
    const { loadAdminMonthlyPayrollEstimateSummary } = await import(
      "./admin-payroll-estimate.ts"
    );
    const failure = new Error("db");
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getMonthlyPayrollEstimateSummary: mocks.getMonthlyPayrollEstimateSummary,
    });
    mocks.getMonthlyPayrollEstimateSummary.mockRejectedValue(failure);
    await expect(
      loadAdminMonthlyPayrollEstimateSummary("2026-08"),
    ).resolves.toEqual({
      status: "error",
      message: "給与見込み一覧を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "admin.payroll-estimate.read.list",
    );
  });
  test("不正monthは入口で拒否し、active staffの権限拒否はApplication結果から表示する", async () => {
    const { loadAdminMonthlyPayrollEstimateSummary } = await import(
      "./admin-payroll-estimate.ts"
    );
    await expect(
      loadAdminMonthlyPayrollEstimateSummary("invalid"),
    ).resolves.toEqual({
      status: "error",
      message: expect.any(String),
    });
    expect(mocks.resolveAuthenticatedUserSession).not.toHaveBeenCalled();
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: { userId: "staff-1", role: "staff", status: "active" },
    });
    mocks.createApplication.mockReturnValue({
      getMonthlyPayrollEstimateSummary: mocks.getMonthlyPayrollEstimateSummary,
    });
    mocks.getMonthlyPayrollEstimateSummary.mockRejectedValue(
      new mocks.PayrollEstimateForbiddenError("ADMIN_ACCESS_REQUIRED"),
    );
    await expect(
      loadAdminMonthlyPayrollEstimateSummary("2026-08"),
    ).resolves.toEqual({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
      message: "この操作を行う権限がありません。",
    });
    expect(mocks.getMonthlyPayrollEstimateSummary).toHaveBeenCalledWith(
      "staff-1",
      "2026-08",
    );
  });

  test("validなuserIdとmonthは管理者認証後に給与見込み詳細を一度だけ取得する", async () => {
    const { loadAdminUserMonthlyPayrollEstimateDetail } = await import(
      "./admin-payroll-estimate.ts"
    );
    const detail = {
      userId: "11111111-1111-4111-8111-111111111111",
      month: "2026-08",
      displayName: null,
      totalEstimatedPayYen: 0,
      uncomputedCount: 0,
      roundingAdjustmentYen: 0,
      attendances: [],
    };
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getUserMonthlyPayrollEstimateDetail:
        mocks.getUserMonthlyPayrollEstimateDetail,
    });
    mocks.getUserMonthlyPayrollEstimateDetail.mockResolvedValue(detail);

    await expect(
      loadAdminUserMonthlyPayrollEstimateDetail(
        "11111111-1111-4111-8111-111111111111",
        "2026-08",
      ),
    ).resolves.toEqual({ status: "ready", data: detail });
    expect(mocks.getUserMonthlyPayrollEstimateDetail).toHaveBeenCalledTimes(1);
    expect(mocks.getUserMonthlyPayrollEstimateDetail).toHaveBeenCalledWith(
      "admin-1",
      "11111111-1111-4111-8111-111111111111",
      "2026-08",
    );
  });
  test("給与見込み詳細 state の構築時に勤怠時刻を ISO/null に直列化する", async () => {
    const { loadAdminUserMonthlyPayrollEstimateDetail } = await import(
      "./admin-payroll-estimate.ts"
    );
    const detail = {
      userId: "11111111-1111-4111-8111-111111111111",
      month: "2026-08",
      displayName: "スタッフ",
      totalEstimatedPayYen: 0,
      uncomputedCount: 0,
      roundingAdjustmentYen: 0,
      attendances: [
        {
          attendanceId: "attendance-1",
          attendanceDate: "2026-08-01",
          workPeriod: "day",
          clockInAt: new Date("2026-08-01T09:00:00.000Z"),
          clockOutAt: new Date("2026-08-01T18:00:00.000Z"),
          workedMinutes: 540,
          hourlyWage: 1200,
          estimatedPayYenTimes60: 648000,
          estimatedPayYen: 10800,
          status: "calculated",
        },
        {
          attendanceId: "attendance-2",
          attendanceDate: "2026-08-02",
          workPeriod: "night",
          clockInAt: new Date(Number.NaN),
          clockOutAt: null,
          workedMinutes: null,
          hourlyWage: null,
          estimatedPayYenTimes60: null,
          estimatedPayYen: null,
          status: "incomplete",
        },
      ],
    };
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getUserMonthlyPayrollEstimateDetail:
        mocks.getUserMonthlyPayrollEstimateDetail,
    });
    mocks.getUserMonthlyPayrollEstimateDetail.mockResolvedValue(detail);

    await expect(
      loadAdminUserMonthlyPayrollEstimateDetail(detail.userId, detail.month),
    ).resolves.toEqual({
      status: "ready",
      data: {
        ...detail,
        attendances: [
          {
            ...detail.attendances[0],
            clockInAt: "2026-08-01T09:00:00.000Z",
            clockOutAt: "2026-08-01T18:00:00.000Z",
          },
          { ...detail.attendances[1], clockInAt: null, clockOutAt: null },
        ],
      },
    });
  });

  test("給与見込み詳細の不正入力を拒否し、対象範囲外はmissingにする", async () => {
    const { loadAdminUserMonthlyPayrollEstimateDetail } = await import(
      "./admin-payroll-estimate.ts"
    );
    await expect(
      loadAdminUserMonthlyPayrollEstimateDetail("not-a-uuid", "2026-08"),
    ).resolves.toEqual({
      status: "error",
      message: "スタッフ別給与見込み詳細を取得できませんでした。",
    });
    expect(mocks.resolveAuthenticatedUserSession).not.toHaveBeenCalled();
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getUserMonthlyPayrollEstimateDetail:
        mocks.getUserMonthlyPayrollEstimateDetail,
    });
    mocks.getUserMonthlyPayrollEstimateDetail.mockRejectedValue(
      new mocks.PayrollEstimateForbiddenError("TARGET_FORBIDDEN"),
    );
    await expect(
      loadAdminUserMonthlyPayrollEstimateDetail(
        "11111111-1111-4111-8111-111111111111",
        "2026-08",
      ),
    ).resolves.toEqual({
      status: "missing",
      message: "対象ユーザーが見つかりません。",
    });
    expect(mocks.getUserMonthlyPayrollEstimateDetail).toHaveBeenCalledWith(
      "admin-1",
      "11111111-1111-4111-8111-111111111111",
      "2026-08",
    );
  });
  test("給与見込み詳細のmissing、0件ready、unexpected errorを区別する", async () => {
    const { loadAdminUserMonthlyPayrollEstimateDetail } = await import(
      "./admin-payroll-estimate.ts"
    );
    const input = ["11111111-1111-4111-8111-111111111111", "2026-08"] as const;
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getUserMonthlyPayrollEstimateDetail:
        mocks.getUserMonthlyPayrollEstimateDetail,
    });
    const empty = {
      userId: input[0],
      month: input[1],
      displayName: "スタッフ",
      totalEstimatedPayYen: 0,
      uncomputedCount: 0,
      roundingAdjustmentYen: 0,
      attendances: [],
    };
    mocks.getUserMonthlyPayrollEstimateDetail.mockResolvedValue(empty);
    await expect(
      loadAdminUserMonthlyPayrollEstimateDetail(...input),
    ).resolves.toEqual({
      status: "ready",
      data: empty,
    });
    mocks.getUserMonthlyPayrollEstimateDetail.mockRejectedValueOnce(
      new mocks.PayrollEstimateTargetUserNotFoundError(),
    );
    await expect(
      loadAdminUserMonthlyPayrollEstimateDetail(...input),
    ).resolves.toEqual({
      status: "missing",
      message: "対象ユーザーが見つかりません。",
    });
    const failure = new Error("db");
    mocks.getUserMonthlyPayrollEstimateDetail.mockRejectedValueOnce(failure);
    await expect(
      loadAdminUserMonthlyPayrollEstimateDetail(...input),
    ).resolves.toEqual({
      status: "error",
      message: "スタッフ別給与見込み詳細を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "admin.payroll-estimate.read.detail",
    );
  });
});
