import { beforeEach, describe, expect, test, vi } from "vitest";

const staffId = "550e8400-e29b-41d4-a716-446655440000";

const mocks = vi.hoisted(() => ({
  loadUsers: vi.fn(),
  creation: vi.fn(),
}));

vi.mock("../../_lib/admin-user-management.ts", () => ({
  loadAdminUsers: mocks.loadUsers,
}));
vi.mock("./_components/attendance-creation", () => ({
  AttendanceCreation: mocks.creation,
}));

describe("admin attendance creation page", () => {
  beforeEach(() => {
    mocks.loadUsers.mockReset().mockResolvedValue({
      status: "ready",
      data: [],
    });
    mocks.creation.mockReset().mockReturnValue(null);
  });

  test("loadAdminUsersの結果とcanonicalQueryをclientへ渡す", async () => {
    const initialUsers = {
      status: "ready" as const,
      data: [],
    };
    mocks.loadUsers.mockResolvedValue(initialUsers);
    const { default: AttendanceCreationPage } = await import("./page");

    const element = await AttendanceCreationPage({
      searchParams: Promise.resolve({
        from: "2026-09-01",
        to: "2026-09-30",
        userId: staffId,
        workPeriod: "night",
        status: "working",
        unknown: "discarded",
      }),
    });

    expect(mocks.loadUsers).toHaveBeenCalledTimes(1);
    expect(element.props.children.props).toEqual({
      initialUsers,
      canonicalQuery: `from=2026-09-01&to=2026-09-30&userId=${staffId}&workPeriod=night&status=working`,
    });
  });

  test("不正または不足した日付条件は一覧条件へ伝播しない", async () => {
    const { default: AttendanceCreationPage } = await import("./page");

    const element = await AttendanceCreationPage({
      searchParams: Promise.resolve({
        from: "2026-02-30",
        to: "2026-03-01",
        unknown: "discarded",
      }),
    });

    expect(element.props.children.props.canonicalQuery).toBe("");
  });
});
