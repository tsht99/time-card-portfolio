import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect: ${path}`);
  }),
  loadAttendance: vi.fn(),
  loadUsers: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./_lib/admin-attendance", () => ({
  loadAdminAttendance: mocks.loadAttendance,
  mapAdminAttendanceRows: (data: unknown) => data,
}));
vi.mock("../_lib/admin-user-management.ts", () => ({
  loadAdminUsers: mocks.loadUsers,
}));
vi.mock("./_components/attendance-client", () => ({
  AttendanceClient: () => null,
}));

const readyAttendance = { status: "ready" as const, data: [] };
const readyUsers = { status: "ready" as const, data: [] };
const staffId = "550e8400-e29b-41d4-a716-446655440000";

async function loadPage(searchParams?: Record<string, string | string[]>) {
  const { default: AttendancePage } = await import("./page");
  return AttendancePage({ searchParams: Promise.resolve(searchParams ?? {}) });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
  mocks.redirect.mockClear();
  mocks.loadAttendance.mockReset().mockResolvedValue(readyAttendance);
  mocks.loadUsers.mockReset().mockResolvedValue(readyUsers);
});

afterEach(() => vi.useRealTimers());

describe("admin attendance page の server-side canonicalization", () => {
  test("不正な日付範囲は root へ redirect し、loader を呼ばない", async () => {
    await expect(
      loadPage({ from: "2026-02-30", to: "2026-02-01" }),
    ).rejects.toThrow("redirect: /admin/attendance");

    expect(mocks.loadAttendance).not.toHaveBeenCalled();
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
        userId: staffId,
      }),
    ).rejects.toThrow(
      `redirect: /admin/attendance?from=2026-08-01&to=2026-08-31&userId=${staffId}&workPeriod=night&status=working`,
    );

    expect(mocks.loadAttendance).not.toHaveBeenCalled();
    expect(mocks.loadUsers).not.toHaveBeenCalled();
  });

  test("UUIDでないuserIdは通常一覧のcanonical URLから除外する", async () => {
    await expect(
      loadPage({
        from: "2026-08-01",
        to: "2026-08-31",
        userId: "staff-1",
      }),
    ).rejects.toThrow(
      "redirect: /admin/attendance?from=2026-08-01&to=2026-08-31",
    );

    expect(mocks.loadAttendance).not.toHaveBeenCalled();
    expect(mocks.loadUsers).not.toHaveBeenCalled();
  });

  test("無効なuserIdを除外したcanonical URLから有効な一覧条件を適用する", async () => {
    await expect(
      loadPage({
        from: "2026-08-01",
        to: "2026-08-31",
        userId: "staff-1",
        workPeriod: "night",
        status: "working",
      }),
    ).rejects.toThrow();

    const redirectDestination = mocks.redirect.mock.calls[0]?.[0];
    expect(redirectDestination).toBe(
      "/admin/attendance?from=2026-08-01&to=2026-08-31&workPeriod=night&status=working",
    );
    if (redirectDestination === undefined) {
      throw new Error("Expected redirect destination.");
    }
    const canonicalQuery = Object.fromEntries(
      new URL(redirectDestination, "http://localhost").searchParams,
    );

    mocks.redirect.mockClear();
    await loadPage(canonicalQuery);

    expect(mocks.redirect).not.toHaveBeenCalled();
    const expectedFilters = {
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
      userId: "",
      workPeriod: "night",
      status: "working",
    };
    expect(mocks.loadAttendance).toHaveBeenCalledWith(expectedFilters);
    expect(mocks.loadUsers).toHaveBeenCalledTimes(1);
  });

  test("UUIDでないuserIdは取消済み一覧のcanonical URLから除外する", async () => {
    await expect(
      loadPage({
        from: "2026-08-01",
        to: "2026-08-31",
        userId: "staff-1",
        status: "cancelled",
      }),
    ).rejects.toThrow(
      "redirect: /admin/attendance?from=2026-08-01&to=2026-08-31&status=cancelled",
    );

    expect(mocks.loadAttendance).not.toHaveBeenCalled();
    expect(mocks.loadUsers).not.toHaveBeenCalled();
  });

  test.each(["from", "to"] as const)(
    "required %s の重複は root へ redirect し、loader を呼ばない",
    async (key) => {
      await expect(
        loadPage({
          from: "2026-08-01",
          to: "2026-08-31",
          [key]:
            key === "from"
              ? ["2026-08-01", "2026-08-02"]
              : ["2026-08-30", "2026-08-31"],
        }),
      ).rejects.toThrow("redirect: /admin/attendance");

      expect(mocks.loadAttendance).not.toHaveBeenCalled();
      expect(mocks.loadUsers).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["userId", ["staff-1", "staff-2"]],
    ["workPeriod", ["day", "night"]],
    ["status", ["working", "completed"]],
  ] as const)(
    "duplicate optional %s is omitted from the canonical URL before loaders",
    async (key, value) => {
      await expect(
        loadPage({
          from: "2026-08-01",
          to: "2026-08-31",
          [key]: [...value],
        }),
      ).rejects.toThrow(
        "redirect: /admin/attendance?from=2026-08-01&to=2026-08-31",
      );

      expect(mocks.loadAttendance).not.toHaveBeenCalled();
      expect(mocks.loadUsers).not.toHaveBeenCalled();
    },
  );

  test("canonical な固定 URL は redirect せず、各 loader を一度だけ呼ぶ", async () => {
    await loadPage({
      from: "2026-08-01",
      to: "2026-08-31",
      userId: staffId,
      workPeriod: "night",
      status: "working",
    });

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.loadAttendance).toHaveBeenCalledTimes(1);
    expect(mocks.loadAttendance).toHaveBeenCalledWith({
      startAttendanceDateInclusive: "2026-08-01",
      endAttendanceDateInclusive: "2026-08-31",
      userId: staffId,
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
    expect(mocks.loadUsers).toHaveBeenCalledTimes(1);
  });
});
