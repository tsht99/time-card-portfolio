import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDetail: vi.fn(),
  loadUsers: vi.fn(),
  correction: vi.fn(),
}));

vi.mock("../../../../../lib/server/admin-attendance", () => ({
  loadAdminAttendanceDetail: mocks.loadDetail,
}));
vi.mock("../../../../../lib/server/admin-user-management", () => ({
  loadAdminUsers: mocks.loadUsers,
}));
vi.mock("./attendance-correction", () => ({
  AttendanceCorrection: mocks.correction,
}));

describe("admin attendance correction page", () => {
  beforeEach(() => {
    mocks.loadDetail.mockReset().mockResolvedValue({
      status: "missing",
      message: "勤怠が見つかりません。",
    });
    mocks.loadUsers.mockReset().mockResolvedValue({
      status: "ready",
      data: [],
    });
    mocks.correction.mockReset().mockReturnValue(null);
  });

  test("attendanceIdをdetail loaderへ渡し、canonicalなdetailHrefを渡す", async () => {
    const { default: AttendanceCorrectionPage } = await import("./page");
    const element = await AttendanceCorrectionPage({
      params: Promise.resolve({ attendanceId: "attendance-197" }),
      searchParams: Promise.resolve({
        from: "2026-09-01",
        to: "2026-09-30",
        userId: "staff-1",
        workPeriod: "night",
        status: "working",
        unknown: "discarded",
      }),
    });

    expect(mocks.loadDetail).toHaveBeenCalledWith("attendance-197");
    expect(mocks.loadUsers).toHaveBeenCalledTimes(1);
    expect(element.props).toEqual(
      expect.objectContaining({
        initialDetail: expect.objectContaining({ status: "missing" }),
        initialUsers: { status: "ready", data: [] },
        detailHref:
          "/admin/attendance/attendance-197?from=2026-09-01&to=2026-09-30&userId=staff-1&workPeriod=night&status=working",
      }),
    );
  });

  test("不正または不足した日付条件ではqueryなしのdetailHrefにする", async () => {
    const { default: AttendanceCorrectionPage } = await import("./page");
    const element = await AttendanceCorrectionPage({
      params: Promise.resolve({ attendanceId: "attendance-197" }),
      searchParams: Promise.resolve({ from: "2026-02-30", to: "2026-03-01" }),
    });

    expect(element.props.detailHref).toBe("/admin/attendance/attendance-197");
  });
});
