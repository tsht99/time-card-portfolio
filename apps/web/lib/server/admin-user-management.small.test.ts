import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn(),
  createApplication: vi.fn(),
  resolveAdminAuthSession: vi.fn(),
  report: vi.fn(),
}));

vi.mock("./users-access", () => ({
  createTimeCardUserReadApplication: mocks.createApplication,
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

afterEach(() =>
  Object.values(mocks).forEach((mock) => {
    mock.mockReset();
  }),
);

describe("admin user-management server read", () => {
  test("ready では application.getUsers を一度だけ呼び、データをそのまま返す", async () => {
    const { loadAdminUsers } = await import("./admin-user-management");
    const users = [
      {
        userId: "staff-1",
        displayName: "スタッフ",
        role: "staff",
        status: "active",
      },
    ] as const;
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({ getUsers: mocks.getUsers });
    mocks.getUsers.mockResolvedValue(users);

    await expect(loadAdminUsers()).resolves.toEqual({
      status: "ready",
      data: users,
    });
    expect(mocks.getUsers).toHaveBeenCalledTimes(1);
  });

  test("missing/unavailable/error では application を実行せず auth state を維持する", async () => {
    const { loadAdminUsers } = await import("./admin-user-management");
    mocks.resolveAdminAuthSession.mockResolvedValueOnce({
      status: "missing",
      message: "ログインが必要です。",
    });
    await expect(loadAdminUsers()).resolves.toEqual({
      status: "missing",
      message: "ログインが必要です。",
    });
    mocks.resolveAdminAuthSession.mockResolvedValueOnce({
      status: "unavailable",
      code: "ACTOR_NOT_ACTIVE",
      message: "利用できません。",
    });
    await expect(loadAdminUsers()).resolves.toEqual({
      status: "unavailable",
      code: "ACTOR_NOT_ACTIVE",
      message: "利用できません。",
    });
    mocks.resolveAdminAuthSession.mockResolvedValueOnce({
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

  test("unexpected は固定 message と operation で report する", async () => {
    const { loadAdminUsers } = await import("./admin-user-management");
    const error = new Error("db");
    mocks.resolveAdminAuthSession.mockResolvedValue(admin);
    mocks.createApplication.mockReturnValue({ getUsers: mocks.getUsers });
    mocks.getUsers.mockRejectedValue(error);

    await expect(loadAdminUsers()).resolves.toEqual({
      status: "error",
      message: "ユーザー一覧を取得できませんでした。",
    });
    expect(mocks.report).toHaveBeenCalledWith(error, "admin.users.read.list");
  });
});
