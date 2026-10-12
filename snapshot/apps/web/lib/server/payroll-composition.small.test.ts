import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminAttendanceDetail: vi.fn(),
  getAttendancePayrollEstimate: vi.fn(),
  createAttendanceApplication: vi.fn(),
  createPayrollEstimateApplication: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@repo/db", () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock("@repo/attendance", () => ({
  createAttendanceApplication: mocks.createAttendanceApplication,
}));
vi.mock("@repo/attendance/infrastructure", () => ({
  PostgresAttendanceCurrentStateReadModel: class {},
}));
vi.mock("@repo/attendance/internal", () => ({
  createAttendancePayrollProjectionReader: vi.fn(),
  PostgresAttendanceEventStore: class {},
}));
vi.mock("@repo/payroll", () => ({
  createPayrollEstimateApplication: mocks.createPayrollEstimateApplication,
  createHourlyWageRuleManagementApplication: vi.fn(),
  PayrollEstimateTargetUserNotFoundError: class extends Error {},
}));
vi.mock("@repo/payroll/infrastructure", () => ({
  PostgresHourlyWageRuleManagementPersistenceAdapter: class {},
  PostgresHourlyWageRuleReadStore: class {},
}));
vi.mock("./users-composition", () => ({
  createTimeCardUserReadApplication: vi.fn(() => ({})),
}));

afterEach(() => vi.resetAllMocks());

test("勤怠詳細表示と給与見込みが同じ一度のAttendance readを使う", async () => {
  const detail = {
    attendanceId: "attendance-1",
    attendanceDate: "2026-05-01",
    userId: "user-1",
    workPeriod: "day",
    clockInAt: "2026-05-01T09:00:00.000Z",
    clockOutAt: "2026-05-01T18:00:00.000Z",
    status: "completed",
    history: [{ eventId: "event-1" }],
  };
  mocks.getAdminAttendanceDetail.mockResolvedValue(detail);
  mocks.getAttendancePayrollEstimate.mockResolvedValue({
    hourlyWage: 1200,
    estimatedPayYen: 10800,
    status: "calculated",
  });
  mocks.createAttendanceApplication.mockReturnValue({
    getAdminAttendanceDetail: mocks.getAdminAttendanceDetail,
  });
  mocks.createPayrollEstimateApplication.mockReturnValue({
    getAttendancePayrollEstimate: mocks.getAttendancePayrollEstimate,
  });

  const { createAdminPayrollEstimateQueries } = await import(
    "./payroll-composition"
  );
  const queries = createAdminPayrollEstimateQueries();
  const result = await queries.getAdminAttendanceDetailWithPayrollEstimate(
    { userId: "admin-1" },
    "attendance-1",
  );

  expect(mocks.getAdminAttendanceDetail).toHaveBeenCalledTimes(1);
  expect(mocks.getAttendancePayrollEstimate).toHaveBeenCalledWith("admin-1", {
    attendanceId: "attendance-1",
    userId: "user-1",
    attendanceDate: "2026-05-01",
    workPeriod: "day",
    clockInAt: new Date("2026-05-01T09:00:00.000Z"),
    clockOutAt: new Date("2026-05-01T18:00:00.000Z"),
    cancelled: false,
  });
  expect(result).toEqual({
    ...detail,
    payrollEstimate: {
      hourlyWage: 1200,
      estimatedPayYen: 10800,
      status: "calculated",
    },
  });
});

test("取得後に勤怠が変更されても、表示と給与見込みには取得済みsnapshotを使う", async () => {
  const detail = {
    attendanceId: "attendance-1",
    attendanceDate: "2026-05-01",
    userId: "user-1",
    workPeriod: "day",
    clockInAt: "2026-05-01T09:00:00.000Z",
    clockOutAt: "2026-05-01T18:00:00.000Z",
    status: "completed",
  };
  mocks.getAdminAttendanceDetail.mockResolvedValue(detail);
  let laterState: { status: string; clockOutAt: string | null } = {
    status: "completed",
    clockOutAt: detail.clockOutAt,
  };
  mocks.getAttendancePayrollEstimate.mockImplementation(async (snapshot) => {
    laterState = { status: "cancelled", clockOutAt: null };
    return { status: snapshot.cancelled ? "excluded" : "calculated" };
  });
  mocks.createAttendanceApplication.mockReturnValue({
    getAdminAttendanceDetail: mocks.getAdminAttendanceDetail,
  });
  mocks.createPayrollEstimateApplication.mockReturnValue({
    getAttendancePayrollEstimate: mocks.getAttendancePayrollEstimate,
  });

  const { createAdminPayrollEstimateQueries } = await import(
    "./payroll-composition"
  );
  const result =
    await createAdminPayrollEstimateQueries().getAdminAttendanceDetailWithPayrollEstimate(
      { userId: "admin-1" },
      "attendance-1",
    );

  expect(mocks.getAdminAttendanceDetail).toHaveBeenCalledTimes(1);
  expect(mocks.getAttendancePayrollEstimate).toHaveBeenCalledWith(
    "admin-1",
    expect.objectContaining({
      clockOutAt: new Date("2026-05-01T18:00:00.000Z"),
      cancelled: false,
    }),
  );
  expect(result.status).toBe("completed");
  expect(result.payrollEstimate).toEqual({ status: "calculated" });
  expect(laterState).toEqual({ status: "cancelled", clockOutAt: null });
});
