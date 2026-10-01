import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect: ${path}`);
  }),
  loadAttendance: vi.fn(),
  loadCancelledAttendance: vi.fn(),
  loadUsers: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../../lib/server/admin-attendance", () => ({
  loadAdminAttendanceList: mocks.loadAttendance,
  loadAdminCancelledAttendanceList: mocks.loadCancelledAttendance,
}));
vi.mock("../../../lib/server/admin-user-management", () => ({
  loadAdminUsers: mocks.loadUsers,
}));
vi.mock("./attendance-client", () => ({
  AttendanceClient: () => null,
}));

const readyAttendance = { status: "ready" as const, data: [] };
const readyCancelledAttendance = { status: "ready" as const, data: [] };
const readyUsers = { status: "ready" as const, data: [] };

async function loadPage(searchParams?: Record<string, string | string[]>) {
  const { default: AttendancePage } = await import("./page");
  return AttendancePage({ searchParams: Promise.resolve(searchParams ?? {}) });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
  mocks.redirect.mockClear();
  mocks.loadAttendance.mockReset().mockResolvedValue(readyAttendance);
  mocks.loadCancelledAttendance
    .mockReset()
    .mockResolvedValue(readyCancelledAttendance);
  mocks.loadUsers.mockReset().mockResolvedValue(readyUsers);
});

afterEach(() => vi.useRealTimers());

describe("admin attendance page の server-side canonicalization", () => {
  test("不正な日付範囲は root へ redirect し、loader を呼ばない", async () => {
    await expect(
      loadPage({ from: "2026-02-30", to: "2026-02-01" }),
    ).rejects.toThrow("redirect: /admin/attendance");

    expect(mocks.loadAttendance).not.toHaveBeenCalled();
    expect(mocks.loadCancelledAttendance).not.toHaveBeenCalled();
    expect(mocks.loadUsers).not.toHaveBeenCalled();
  });

  test("有効条件と未知パラメータの混在は canonical URL へ redirect する", async () => {
    await expect(
      loadPage({
        from: "2026-08-01",
        to: "2026-08-31",
        unknown: "value",
        workPeriod: "night",
        status: "working",
        userId: "staff-1",
      }),
    ).rejects.toThrow(
      "redirect: /admin/attendance?from=2026-08-01&to=2026-08-31&userId=staff-1&workPeriod=night&status=working",
    );

    expect(mocks.loadAttendance).not.toHaveBeenCalled();
    expect(mocks.loadCancelledAttendance).not.toHaveBeenCalled();
    expect(mocks.loadUsers).not.toHaveBeenCalled();
  });

  test("canonical な固定 URL は redirect せず、各 loader を一度だけ呼ぶ", async () => {
    await loadPage({
      from: "2026-08-01",
      to: "2026-08-31",
      userId: "staff-1",
      workPeriod: "night",
      status: "working",
    });

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.loadAttendance).toHaveBeenCalledTimes(1);
    expect(mocks.loadAttendance).toHaveBeenCalledWith({
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
      userId: "staff-1",
      workPeriod: "night",
      status: "working",
    });
    expect(mocks.loadCancelledAttendance).toHaveBeenCalledTimes(1);
    expect(mocks.loadCancelledAttendance).toHaveBeenCalledWith({
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
      userId: "staff-1",
      workPeriod: "night",
      status: "working",
    });
    expect(mocks.loadUsers).toHaveBeenCalledTimes(1);
  });

  test("cancelled status は canonical URL として保持し各 loader に渡す", async () => {
    await loadPage({
      from: "2026-08-01",
      to: "2026-08-31",
      status: "cancelled",
    });

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.loadAttendance).toHaveBeenCalledWith({
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
      userId: "",
      workPeriod: "",
      status: "cancelled",
    });
    expect(mocks.loadCancelledAttendance).toHaveBeenCalledWith({
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
      userId: "",
      workPeriod: "",
      status: "cancelled",
    });
  });

  test("旧 incomplete status は canonical URL から除外する", async () => {
    await expect(
      loadPage({
        from: "2026-08-01",
        to: "2026-08-31",
        status: "incomplete",
      }),
    ).rejects.toThrow(
      "redirect: /admin/attendance?from=2026-08-01&to=2026-08-31",
    );

    expect(mocks.loadAttendance).not.toHaveBeenCalled();
    expect(mocks.loadCancelledAttendance).not.toHaveBeenCalled();
    expect(mocks.loadUsers).not.toHaveBeenCalled();
  });

  test("パラメータなしの root URL は動的デフォルトで loader を呼ぶ", async () => {
    await loadPage();

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.loadAttendance).toHaveBeenCalledTimes(1);
    expect(mocks.loadAttendance).toHaveBeenCalledWith({
      startAttendanceDateInclusive: "2026-08-27",
      endAttendanceDateInclusive: "2026-09-02",
      userId: "",
      workPeriod: "",
      status: "",
    });
    expect(mocks.loadCancelledAttendance).toHaveBeenCalledTimes(1);
    expect(mocks.loadCancelledAttendance).toHaveBeenCalledWith({
      startAttendanceDateInclusive: "2026-08-27",
      endAttendanceDateInclusive: "2026-09-02",
      userId: "",
      workPeriod: "",
      status: "",
    });
    expect(mocks.loadUsers).toHaveBeenCalledTimes(1);
  });
});
