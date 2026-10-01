// cspell:ignore uncomputed
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  AttendanceEventStreamNotFoundError: class extends Error {},
  PayrollTargetUserNotFoundError: class extends Error {},
  getAdminAttendanceDetailWithPayroll: vi.fn(),
  getAdminAttendanceList: vi.fn(),
  getAdminCancelledAttendanceList: vi.fn(),
  getUserMonthlyPayrollDetail: vi.fn(),
  getMonthlyPayrollSummary: vi.fn(),
  createApplication: vi.fn(),
  resolveAdminAuthSession: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@repo/db", () => ({ getDatabase: vi.fn() }));
vi.mock("./attendance-composition", () => ({
  AttendanceEventStreamNotFoundError: mocks.AttendanceEventStreamNotFoundError,
  PayrollTargetUserNotFoundError: mocks.PayrollTargetUserNotFoundError,
  createAttendanceApplication: mocks.createApplication,
}));
vi.mock("@repo/attendance", () => ({
  AttendanceEventStreamNotFoundError: mocks.AttendanceEventStreamNotFoundError,
}));
vi.mock("./payroll-composition", () => ({
  createAdminPayrollQueries: mocks.createApplication,
  isPayrollTargetUserNotFoundError: (error: unknown) =>
    error instanceof mocks.PayrollTargetUserNotFoundError,
}));
vi.mock("./auth-session", () => ({
  resolveAdminAuthSession: mocks.resolveAdminAuthSession,
}));
vi.mock("../server-observability", () => ({
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

describe("admin attendance server reads", () => {
  test("ready admin は詳細を一度だけ取得する", async () => {
    const { loadAdminAttendanceDetail } = await import("./admin-attendance");
    const detail = { attendanceId, history: [] };
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminAttendanceDetailWithPayroll:
        mocks.getAdminAttendanceDetailWithPayroll,
    });
    mocks.getAdminAttendanceDetailWithPayroll.mockResolvedValue(detail);

    await expect(loadAdminAttendanceDetail(attendanceId)).resolves.toEqual({
      status: "ready",
      data: detail,
    });
    expect(mocks.getAdminAttendanceDetailWithPayroll).toHaveBeenCalledTimes(1);
    expect(mocks.getAdminAttendanceDetailWithPayroll).toHaveBeenCalledWith(
      attendanceId,
    );
  });

  test("空またはUUIDでないattendanceIdは認証前に拒否する", async () => {
    const { loadAdminAttendanceDetail } = await import("./admin-attendance");

    for (const invalidId of ["", "not-a-uuid"]) {
      await expect(loadAdminAttendanceDetail(invalidId)).resolves.toEqual({
        status: "error",
        message: "勤怠詳細を取得できませんでした。",
      });
    }
    expect(mocks.resolveAdminAuthSession).not.toHaveBeenCalled();
    expect(mocks.createApplication).not.toHaveBeenCalled();
  });

  test("詳細のnon-ready authはapplicationを呼ばず認証状態を返す", async () => {
    const { loadAdminAttendanceDetail } = await import("./admin-attendance");
    mocks.resolveAdminAuthSession.mockResolvedValue({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
      message: "権限なし",
    });

    await expect(loadAdminAttendanceDetail(attendanceId)).resolves.toEqual({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
      message: "権限なし",
    });
    expect(mocks.createApplication).not.toHaveBeenCalled();
  });

  test("詳細のmissing streamはmissing stateへ変換する", async () => {
    const { loadAdminAttendanceDetail } = await import("./admin-attendance");
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminAttendanceDetailWithPayroll:
        mocks.getAdminAttendanceDetailWithPayroll,
    });
    mocks.getAdminAttendanceDetailWithPayroll.mockRejectedValue(
      new mocks.AttendanceEventStreamNotFoundError(),
    );

    await expect(
      loadAdminAttendanceDetail("66666666-6666-4666-8666-666666666667"),
    ).resolves.toEqual({
      status: "missing",
      message: "勤怠が見つかりません。",
    });
    expect(mocks.report).not.toHaveBeenCalled();
  });

  test("詳細のunexpected failureは固定messageとoperationになる", async () => {
    const { loadAdminAttendanceDetail } = await import("./admin-attendance");
    const failure = new Error("db");
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminAttendanceDetailWithPayroll:
        mocks.getAdminAttendanceDetailWithPayroll,
    });
    mocks.getAdminAttendanceDetailWithPayroll.mockRejectedValue(failure);

    await expect(loadAdminAttendanceDetail(attendanceId)).resolves.toEqual({
      status: "error",
      message: "勤怠詳細を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "admin.attendance.read.detail",
    );
  });

  test("ready admin は取消済み一覧の空 optional filter を正規化して一度だけ呼ぶ", async () => {
    const { loadAdminCancelledAttendanceList } = await import(
      "./admin-attendance"
    );
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminCancelledAttendanceList: mocks.getAdminCancelledAttendanceList,
    });
    mocks.getAdminCancelledAttendanceList.mockResolvedValue([]);
    await expect(
      loadAdminCancelledAttendanceList({
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
        userId: "",
        workPeriod: "",
        status: "",
      }),
    ).resolves.toEqual({ status: "ready", data: [] });
    expect(mocks.getAdminCancelledAttendanceList).toHaveBeenCalledTimes(1);
    expect(mocks.getAdminCancelledAttendanceList).toHaveBeenCalledWith({
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
    });
  });

  test.each(["working", "completed"] as const)(
    "%s状態フィルター指定時は取消済み一覧 application を呼ばず空配列を返す",
    async (status) => {
      const { loadAdminCancelledAttendanceList } = await import(
        "./admin-attendance"
      );
      mocks.resolveAdminAuthSession.mockResolvedValue(admin);
      await expect(
        loadAdminCancelledAttendanceList({
          startAttendanceDateInclusive: "2026-08-01",
          endAttendanceDateInclusive: "2026-08-31",
          userId: "",
          workPeriod: "",
          status,
        }),
      ).resolves.toEqual({ status: "ready", data: [] });
      expect(mocks.getAdminCancelledAttendanceList).not.toHaveBeenCalled();
    },
  );

  test("ready admin は空の optional filter を正規化して一覧 application を一度だけ呼ぶ", async () => {
    const { loadAdminAttendanceList } = await import("./admin-attendance");
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminAttendanceList: mocks.getAdminAttendanceList,
    });
    mocks.getAdminAttendanceList.mockResolvedValue([]);
    await expect(
      loadAdminAttendanceList({
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
        userId: "",
        workPeriod: "",
        status: "",
      }),
    ).resolves.toEqual({ status: "ready", data: [] });
    expect(mocks.getAdminAttendanceList).toHaveBeenCalledWith({
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
    });
  });

  test("cancelled は通常一覧を呼ばず取消済み一覧だけを呼ぶ", async () => {
    const { loadAdminAttendanceList, loadAdminCancelledAttendanceList } =
      await import("./admin-attendance");
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminCancelledAttendanceList: mocks.getAdminCancelledAttendanceList,
    });
    mocks.getAdminCancelledAttendanceList.mockResolvedValue([]);

    await expect(
      loadAdminAttendanceList({
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
        userId: "",
        workPeriod: "",
        status: "cancelled",
      }),
    ).resolves.toEqual({ status: "ready", data: [] });
    await expect(
      loadAdminCancelledAttendanceList({
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
        userId: "",
        workPeriod: "",
        status: "cancelled",
      }),
    ).resolves.toEqual({ status: "ready", data: [] });

    expect(mocks.getAdminAttendanceList).not.toHaveBeenCalled();
    expect(mocks.getAdminCancelledAttendanceList).toHaveBeenCalledTimes(1);
  });

  test("invalid query と non-ready auth は application を呼ばない", async () => {
    const { loadAdminAttendanceList, loadAdminMonthlyPayrollSummary } =
      await import("./admin-attendance");
    await expect(
      loadAdminAttendanceList({
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
        userId: "not-a-uuid",
        workPeriod: "",
        status: "",
      }),
    ).resolves.toMatchObject({ status: "error" });
    mocks.resolveAdminAuthSession.mockResolvedValue({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
      message: "権限なし",
    });
    await expect(
      loadAdminMonthlyPayrollSummary("2026-08"),
    ).resolves.toMatchObject({ status: "unavailable" });
    expect(mocks.createApplication).not.toHaveBeenCalled();
  });

  test("monthly failure は固定 operation と generic message になる", async () => {
    const { loadAdminMonthlyPayrollSummary } = await import(
      "./admin-attendance"
    );
    const failure = new Error("db");
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getMonthlyPayrollSummary: mocks.getMonthlyPayrollSummary,
    });
    mocks.getMonthlyPayrollSummary.mockRejectedValue(failure);
    await expect(loadAdminMonthlyPayrollSummary("2026-08")).resolves.toEqual({
      status: "error",
      message: "給与一覧を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "admin.payroll.read.list",
    );
  });

  test("validなuserIdとmonthは管理者認証後に給与詳細を一度だけ取得する", async () => {
    const { loadAdminUserMonthlyPayrollDetail } = await import(
      "./admin-attendance"
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
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getUserMonthlyPayrollDetail: mocks.getUserMonthlyPayrollDetail,
    });
    mocks.getUserMonthlyPayrollDetail.mockResolvedValue(detail);

    await expect(
      loadAdminUserMonthlyPayrollDetail(
        "11111111-1111-4111-8111-111111111111",
        "2026-08",
      ),
    ).resolves.toEqual({ status: "ready", data: detail });
    expect(mocks.getUserMonthlyPayrollDetail).toHaveBeenCalledTimes(1);
    expect(mocks.getUserMonthlyPayrollDetail).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "2026-08",
    );
  });

  test("給与詳細の不正入力とnon-ready authはapplicationを呼ばない", async () => {
    const { loadAdminUserMonthlyPayrollDetail } = await import(
      "./admin-attendance"
    );
    await expect(
      loadAdminUserMonthlyPayrollDetail("not-a-uuid", "2026-08"),
    ).resolves.toEqual({
      status: "error",
      message: "スタッフ別給与詳細を取得できませんでした。",
    });
    expect(mocks.resolveAdminAuthSession).not.toHaveBeenCalled();
    mocks.resolveAdminAuthSession.mockResolvedValue({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
      message: "権限なし",
    });
    await expect(
      loadAdminUserMonthlyPayrollDetail(
        "11111111-1111-4111-8111-111111111111",
        "2026-08",
      ),
    ).resolves.toEqual({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
      message: "権限なし",
    });
    expect(mocks.createApplication).not.toHaveBeenCalled();
  });

  test("給与詳細のmissing、0件ready、unexpected errorを区別する", async () => {
    const { loadAdminUserMonthlyPayrollDetail } = await import(
      "./admin-attendance"
    );
    const input = ["11111111-1111-4111-8111-111111111111", "2026-08"] as const;
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getUserMonthlyPayrollDetail: mocks.getUserMonthlyPayrollDetail,
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
    mocks.getUserMonthlyPayrollDetail.mockResolvedValue(empty);
    await expect(loadAdminUserMonthlyPayrollDetail(...input)).resolves.toEqual({
      status: "ready",
      data: empty,
    });
    mocks.getUserMonthlyPayrollDetail.mockRejectedValueOnce(
      new mocks.PayrollTargetUserNotFoundError(),
    );
    await expect(loadAdminUserMonthlyPayrollDetail(...input)).resolves.toEqual({
      status: "missing",
      message: "対象ユーザーが見つかりません。",
    });
    const failure = new Error("db");
    mocks.getUserMonthlyPayrollDetail.mockRejectedValueOnce(failure);
    await expect(loadAdminUserMonthlyPayrollDetail(...input)).resolves.toEqual({
      status: "error",
      message: "スタッフ別給与詳細を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "admin.payroll.read.detail",
    );
  });

  test("list の unexpected failure は generic message と固定 operation になる", async () => {
    const { loadAdminAttendanceList } = await import("./admin-attendance");
    const failure = new Error("db");
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminAttendanceList: mocks.getAdminAttendanceList,
    });
    mocks.getAdminAttendanceList.mockRejectedValue(failure);
    await expect(
      loadAdminAttendanceList({
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
        userId: "",
        workPeriod: "",
        status: "",
      }),
    ).resolves.toEqual({
      status: "error",
      message: "勤怠一覧を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "admin.attendance.read.list",
    );
  });

  test("取消済み一覧の unexpected failure は固定 message と operation になる", async () => {
    const { loadAdminCancelledAttendanceList } = await import(
      "./admin-attendance"
    );
    const failure = new Error("db");
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({
      getAdminCancelledAttendanceList: mocks.getAdminCancelledAttendanceList,
    });
    mocks.getAdminCancelledAttendanceList.mockRejectedValue(failure);
    await expect(
      loadAdminCancelledAttendanceList({
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
        userId: "",
        workPeriod: "",
        status: "",
      }),
    ).resolves.toEqual({
      status: "error",
      message: "取消済み勤怠を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "admin.attendance.read.cancelled-list",
    );
  });

  test.each(["", "cancelled"] as const)(
    "取消済み一覧の %s status で non-ready auth は application を呼ばず保持する",
    async (status) => {
      const { loadAdminCancelledAttendanceList } = await import(
        "./admin-attendance"
      );
      mocks.resolveAdminAuthSession.mockResolvedValue({
        status: "error",
        message: "認証情報を確認できませんでした。",
      });
      await expect(
        loadAdminCancelledAttendanceList({
          startAttendanceDateInclusive: "2026-08-01",
          endAttendanceDateInclusive: "2026-08-31",
          userId: "",
          workPeriod: "",
          status,
        }),
      ).resolves.toEqual({
        status: "error",
        message: "認証情報を確認できませんでした。",
      });
      expect(mocks.getAdminCancelledAttendanceList).not.toHaveBeenCalled();
    },
  );

  test("auth resolver の error は list / monthly とも application を呼ばず保持する", async () => {
    const { loadAdminAttendanceList, loadAdminMonthlyPayrollSummary } =
      await import("./admin-attendance");
    mocks.resolveAdminAuthSession.mockResolvedValue({
      status: "error",
      message: "認証情報を確認できませんでした。",
    });
    await expect(
      loadAdminAttendanceList({
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
        userId: "",
        workPeriod: "",
        status: "",
      }),
    ).resolves.toEqual({
      status: "error",
      message: "認証情報を確認できませんでした。",
    });
    await expect(
      loadAdminAttendanceList({
        startAttendanceDateInclusive: "2026-08-01",
        endAttendanceDateInclusive: "2026-08-31",
        userId: "",
        workPeriod: "",
        status: "cancelled",
      }),
    ).resolves.toEqual({
      status: "error",
      message: "認証情報を確認できませんでした。",
    });
    await expect(loadAdminMonthlyPayrollSummary("2026-08")).resolves.toEqual({
      status: "error",
      message: "認証情報を確認できませんでした。",
    });
    expect(mocks.createApplication).not.toHaveBeenCalled();
  });
});
