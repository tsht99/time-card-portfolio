import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieStore: { get: vi.fn(), set: vi.fn() },
  resolveActiveSession: vi.fn(),
  report: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookieStore),
}));
vi.mock("./users-access", () => ({
  createTimeCardAuthenticationApplication: vi.fn(() => ({
    resolveActiveSession: mocks.resolveActiveSession,
  })),
}));
vi.mock("@repo/users", () => ({
  authorizeActiveUser: vi.fn((user) =>
    user?.status === "active"
      ? { ok: true, user }
      : { ok: false, code: "ACTOR_NOT_ACTIVE" },
  ),
  authorizeActiveAdmin: vi.fn((user) => {
    if (user?.status !== "active")
      return { ok: false, code: "ACTOR_NOT_ACTIVE" };
    return user.role === "admin"
      ? { ok: true, user }
      : { ok: false, code: "ADMIN_ACCESS_REQUIRED" };
  }),
}));
vi.mock("../server-observability", () => ({
  reportUnexpectedServerException: mocks.report,
}));

const activeStaff = {
  userId: "staff-1",
  displayName: "スタッフ",
  role: "staff",
  status: "active",
};
const activeAdmin = {
  ...activeStaff,
  userId: "admin-1",
  role: "admin",
};

afterEach(() => {
  mocks.cookieStore.get.mockReset();
  mocks.cookieStore.set.mockReset();
  mocks.resolveActiveSession.mockReset();
  mocks.report.mockReset();
  vi.unstubAllEnvs();
});

describe("Task 5 auth session bootstrap", () => {
  test("cookie なし、invalid/expired session は missing", async () => {
    const { resolveStaffAuthSession } = await import("./auth-session");
    mocks.cookieStore.get.mockReturnValue(undefined);
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: false,
      code: "SESSION_EXPIRED",
    });
    await expect(resolveStaffAuthSession()).resolves.toMatchObject({
      status: "missing",
    });

    mocks.cookieStore.get.mockReturnValue({ value: "invalid-or-expired" });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: false,
      code: "SESSION_EXPIRED",
    });
    await expect(resolveStaffAuthSession()).resolves.toMatchObject({
      status: "missing",
    });
  });

  test("active staff/admin を staff bootstrap する", async () => {
    const { resolveStaffAuthSession } = await import("./auth-session");
    mocks.cookieStore.get.mockReturnValue({ value: "session" });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: true,
      user: activeStaff,
    });
    await expect(resolveStaffAuthSession()).resolves.toEqual({
      status: "ready",
      user: activeStaff,
    });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: true,
      user: activeAdmin,
    });
    await expect(resolveStaffAuthSession()).resolves.toEqual({
      status: "ready",
      user: activeAdmin,
    });
  });

  test("active admin は ready、active staff は ADMIN_ACCESS_REQUIRED、inactive actor は ACTOR_NOT_ACTIVE", async () => {
    const { resolveAdminAuthSession } = await import("./auth-session");
    mocks.cookieStore.get.mockReturnValue({ value: "session" });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: true,
      user: activeAdmin,
    });
    await expect(resolveAdminAuthSession()).resolves.toEqual({
      status: "ready",
      user: activeAdmin,
    });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: true,
      user: activeStaff,
    });
    await expect(resolveAdminAuthSession()).resolves.toMatchObject({
      status: "unavailable",
      code: "ADMIN_ACCESS_REQUIRED",
    });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: true,
      user: { ...activeStaff, status: "inactive" },
    });
    await expect(resolveAdminAuthSession()).resolves.toMatchObject({
      status: "unavailable",
      code: "ACTOR_NOT_ACTIVE",
      message: "このアカウントは現在、管理画面を利用できません。",
    });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: false,
      code: "SESSION_EXPIRED",
    });
    await expect(resolveAdminAuthSession()).resolves.toMatchObject({
      status: "missing",
    });
  });

  test("unexpected resolver failure は observability と error state になる", async () => {
    const { resolveAdminAuthSession } = await import("./auth-session");
    const error = new Error("database unavailable");
    mocks.resolveActiveSession.mockRejectedValueOnce(error);
    await expect(resolveAdminAuthSession()).resolves.toMatchObject({
      status: "error",
    });
    expect(mocks.report).toHaveBeenCalledWith(error, "auth.session.admin");
  });

  test("session cookie は安全な属性と session result の expires を使い production だけ secure", async () => {
    const { setTimeCardSessionCookie } = await import("./auth-session");
    const expiresAt = new Date("2026-09-30T00:00:00.000Z");
    vi.stubEnv("NODE_ENV", "test");
    await setTimeCardSessionCookie("session-id", expiresAt);
    expect(mocks.cookieStore.set).toHaveBeenLastCalledWith(
      "timecard_session",
      "session-id",
      {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        expires: expiresAt,
        secure: false,
      },
    );
    vi.stubEnv("NODE_ENV", "production");
    await setTimeCardSessionCookie("session-id", expiresAt);
    expect(mocks.cookieStore.set).toHaveBeenLastCalledWith(
      "timecard_session",
      "session-id",
      expect.objectContaining({ secure: true, expires: expiresAt }),
    );
  });
});
