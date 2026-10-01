import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadDetail: vi.fn(),
  loadUsers: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("../../../../lib/server/admin-attendance", () => ({
  loadAdminAttendanceDetail: mocks.loadDetail,
}));
vi.mock("../../../../lib/server/admin-user-management", () => ({
  loadAdminUsers: mocks.loadUsers,
}));
vi.mock("./attendance-detail", () => ({
  AttendanceDetail: mocks.detail,
}));

describe("admin attendance detail page", () => {
  beforeEach(() => {
    mocks.loadDetail.mockReset().mockResolvedValue({
      status: "missing",
      message: "勤怠が見つかりません。",
    });
    mocks.loadUsers.mockReset().mockResolvedValue({
      status: "ready",
      data: [],
    });
    mocks.detail.mockReset().mockReturnValue(null);
  });

  test("attendanceIdをdetail loaderへ渡し、usersとstateを表示コンポーネントへ渡す", async () => {
    const { default: AttendanceDetailPage } = await import("./page");
    const element = await AttendanceDetailPage({
      params: Promise.resolve({ attendanceId: "attendance-195" }),
    });

    expect(mocks.loadDetail).toHaveBeenCalledWith("attendance-195");
    expect(mocks.loadUsers).toHaveBeenCalledTimes(1);
    expect(element.props).toEqual(
      expect.objectContaining({
        initialDetail: expect.objectContaining({ status: "missing" }),
        initialUsers: expect.objectContaining({ status: "ready" }),
      }),
    );
  });

  test("有効なfilterをdetailHrefとcorrectionHrefへ渡す", async () => {
    const { default: AttendanceDetailPage } = await import("./page");
    const element = await AttendanceDetailPage({
      params: Promise.resolve({ attendanceId: "attendance-195" }),
      searchParams: Promise.resolve({
        from: "2026-09-01",
        to: "2026-09-30",
        userId: "staff-1",
        workPeriod: "night",
        status: "working",
        unknown: "discarded",
      }),
    });

    expect(element.props.correctionHref).toBe(
      "/admin/attendance/attendance-195/edit?from=2026-09-01&to=2026-09-30&userId=staff-1&workPeriod=night&status=working",
    );
  });

  test("不正なworkPeriod / statusとunknown keyはcorrectionHrefへ混ぜない", async () => {
    const { default: AttendanceDetailPage } = await import("./page");
    const element = await AttendanceDetailPage({
      params: Promise.resolve({ attendanceId: "attendance-195" }),
      searchParams: Promise.resolve({
        from: "2026-09-01",
        to: "2026-09-30",
        userId: "staff-1",
        workPeriod: "invalid",
        status: "invalid",
        unknown: "discarded",
      }),
    });

    expect(element.props.correctionHref).toBe(
      "/admin/attendance/attendance-195/edit?from=2026-09-01&to=2026-09-30&userId=staff-1",
    );
  });

  test.each([
    [{ from: "2026-02-30", to: "2026-03-01" }],
    [{ from: "2026-09-01" }],
    [{ from: ["2026-09-01"], to: "2026-09-30" }],
  ])("不正または不足した日付条件では一覧rootへ戻す", async (searchParams) => {
    const { default: AttendanceDetailPage } = await import("./page");
    const element = await AttendanceDetailPage({
      params: Promise.resolve({ attendanceId: "attendance-195" }),
      searchParams: Promise.resolve(searchParams),
    });

    expect(element.props.correctionHref).toBe(
      "/admin/attendance/attendance-195/edit",
    );
    expect(mocks.loadDetail).toHaveBeenCalledWith("attendance-195");
  });
});
