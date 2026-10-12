import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  createApplication: vi.fn(),
  resolveAuthenticatedUserSession: vi.fn(),
  report: vi.fn(),
}));

vi.mock("../../../lib/server/users-composition", () => ({
  createTimeCardAdminUserReadApplication: mocks.createApplication,
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
    mock.mockReset();
  }),
);

describe("admin user-management server read", () => {
  test("ready では application.getUsers を一度だけ呼び、データをそのまま返す", async () => {
    const { loadAdminUsers } = await import("./admin-user-management.ts");
    const users = [
      {
        userId: "staff-1",
        displayName: "スタッフ",
        role: "staff",
        status: "active",
      },
    ] as const;
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({ getUsers: mocks.getUsers });
    mocks.getUsers.mockResolvedValue({ kind: "success", users });

    await expect(loadAdminUsers()).resolves.toEqual({
      status: "ready",
      data: users,
    });
    expect(mocks.getUsers).toHaveBeenCalledTimes(1);
    expect(mocks.getUsers).toHaveBeenCalledWith("admin-1");
  });

  test("missing/error は auth state を維持し、Applicationの拒否は unavailable にする", async () => {
    const { loadAdminUsers } = await import("./admin-user-management.ts");
    mocks.resolveAuthenticatedUserSession.mockResolvedValueOnce({
      status: "missing",
      message: "ログインが必要です。",
    });
    await expect(loadAdminUsers()).resolves.toEqual({
      status: "missing",
      message: "ログインが必要です。",
    });
    mocks.resolveAuthenticatedUserSession.mockResolvedValueOnce({
      status: "error",
      message: "認証状態を確認できませんでした。",
    });
    await expect(loadAdminUsers()).resolves.toEqual({
      status: "error",
      message: "認証状態を確認できませんでした。",
    });
    expect(mocks.createApplication).not.toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  test("active staff は Application が拒否し、管理者権限なしとして表示する", async () => {
    const { loadAdminUsers } = await import("./admin-user-management.ts");
    mocks.resolveAuthenticatedUserSession.mockResolvedValue({
      status: "ready",
      user: { userId: "staff-1", role: "staff", status: "active" },
    });
    mocks.createApplication.mockReturnValue({ getUsers: mocks.getUsers });
    mocks.getUsers.mockResolvedValue({
      kind: "actor-forbidden",
      code: "ADMIN_ACCESS_REQUIRED",
    });
    await expect(loadAdminUsers()).resolves.toMatchObject({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
    });
    expect(mocks.getUsers).toHaveBeenCalledWith("staff-1");
  });

  test("unexpected は固定 message と operation で report する", async () => {
    const { loadAdminUsers } = await import("./admin-user-management.ts");
    const error = new Error("db");
    mocks.resolveAuthenticatedUserSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({ getUsers: mocks.getUsers });
    mocks.getUsers.mockRejectedValue(error);

    await expect(loadAdminUsers()).resolves.toEqual({
      status: "error",
      message: "ユーザー一覧を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(error, "admin.users.read.list");
  });
});
