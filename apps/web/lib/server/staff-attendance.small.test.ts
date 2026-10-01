import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStaffCurrentAttendance: vi.fn(),
  getAttendanceHistory: vi.fn(),
  createApplication: vi.fn(),
  report: vi.fn(),
}));

vi.mock("@repo/db", () => ({ getDatabase: vi.fn() }));
vi.mock("./attendance-composition", () => ({
  createAttendanceApplication: mocks.createApplication,
}));
vi.mock("../server-observability", () => ({
  reportUnexpectedServerException: mocks.report,
}));

const current = {
  referenceDate: "2026-09-01",
  attendances: [
    {
      attendanceId: "working-1",
      eventVersion: 2,
      attendanceDate: "2026-08-31",
      workPeriod: "day" as const,
      clockInAt: "2026-08-31T23:30:00.000Z",
      clockOutAt: null,
      workedMinutes: null,
    },
  ],
};
const history = [current.attendances[0]];
const referenceTime = new Date("2026-09-17T03:00:00.000Z");

afterEach(() => {
  mocks.getStaffCurrentAttendance.mockReset();
  mocks.getAttendanceHistory.mockReset();
  mocks.createApplication.mockReset();
  mocks.report.mockReset();
});

function mockApplication() {
  mocks.createApplication.mockReturnValue({
    getStaffCurrentAttendance: mocks.getStaffCurrentAttendance,
    getAttendanceHistory: mocks.getAttendanceHistory,
  });
}

describe("staff attendance server read", () => {
  test("current loader passes through canonical data and reference time", async () => {
    const { loadStaffCurrentAttendance } = await import("./staff-attendance");
    mockApplication();
    mocks.getStaffCurrentAttendance.mockResolvedValue(current);

    await expect(
      loadStaffCurrentAttendance("staff-1", referenceTime),
    ).resolves.toEqual({ status: "ready", data: current });
    expect(mocks.getStaffCurrentAttendance).toHaveBeenCalledWith("staff-1");
    expect(mocks.createApplication).toHaveBeenCalledWith({
      now: expect.any(Function),
    });
    expect(mocks.createApplication.mock.calls[0]?.[0].now()).toBe(
      referenceTime,
    );
  });

  test("current loader returns a fixed error and reports its operation", async () => {
    const { loadStaffCurrentAttendance } = await import("./staff-attendance");
    const failure = new Error("database unavailable");
    mockApplication();
    mocks.getStaffCurrentAttendance.mockRejectedValue(failure);

    await expect(
      loadStaffCurrentAttendance("staff-1", referenceTime),
    ).resolves.toEqual({
      status: "error",
      message: "現在の勤怠を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "staff.attendance.read.current",
    );
  });

  test("history loader passes through canonical data for the selected month", async () => {
    const { loadStaffAttendanceHistory } = await import("./staff-attendance");
    mockApplication();
    mocks.getAttendanceHistory.mockResolvedValue(history);

    await expect(
      loadStaffAttendanceHistory("staff-1", "2026-09"),
    ).resolves.toEqual({ status: "ready", data: history });
    expect(mocks.getAttendanceHistory).toHaveBeenCalledWith(
      "staff-1",
      "2026-09",
    );
    expect(mocks.createApplication).toHaveBeenCalledWith({});
  });

  test("history loader returns a fixed error and reports its operation", async () => {
    const { loadStaffAttendanceHistory } = await import("./staff-attendance");
    const failure = new Error("database unavailable");
    mockApplication();
    mocks.getAttendanceHistory.mockRejectedValue(failure);

    await expect(
      loadStaffAttendanceHistory("staff-1", "2026-09"),
    ).resolves.toEqual({
      status: "error",
      message: "勤怠履歴を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(
      failure,
      "staff.attendance.read.history",
    );
  });
});
