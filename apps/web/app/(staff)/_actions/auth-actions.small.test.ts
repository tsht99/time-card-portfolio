import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateWithLine: vi.fn(),
  resolveActiveSession: vi.fn(),
  setCookie: vi.fn(),
  reportUnexpectedServerException: vi.fn(),
  reportLineServiceUnavailable: vi.fn(),
  authorizeActiveUser: vi.fn((user) => ({ ok: true, user })),
  authorizeActiveAdmin: vi.fn((user) => ({ ok: true, user })),
}));

vi.mock("@repo/users", () => ({
  authorizeActiveUser: mocks.authorizeActiveUser,
  authorizeActiveAdmin: mocks.authorizeActiveAdmin,
}));
vi.mock("../../../lib/server/auth-session", () => ({
  setTimeCardSessionCookie: mocks.setCookie,
}));
vi.mock("../../../lib/server/users-access", () => ({
  createTimeCardAuthenticationApplication: vi.fn(() => ({
    authenticateWithLine: mocks.authenticateWithLine,
    resolveActiveSession: mocks.resolveActiveSession,
  })),
}));
vi.mock("../../../lib/server-observability", () => ({
  reportUnexpectedServerException: mocks.reportUnexpectedServerException,
  reportLineServiceUnavailable: mocks.reportLineServiceUnavailable,
}));

const user = {
  userId: "admin-1",
  displayName: "管理者",
  role: "admin",
  status: "active",
};
const input = { idToken: "id-token", accessToken: null };

afterEach(() => {
  Object.values(mocks).forEach((mock) => {
    mock.mockReset();
  });
});

describe("Task 5 LINE session Server Actions", () => {
  test("unknown input は strict validation で拒否する", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    await expect(
      createStaffLineSessionAction({ ...input, extra: true }),
    ).resolves.toMatchObject({ success: false, code: "LINE_AUTH_REQUIRED" });
    expect(mocks.authenticateWithLine).not.toHaveBeenCalled();
  });

  test("typed failure を維持し、成功結果から sessionId を露出しない", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: false,
      code: "LINE_AUTH_FAILED",
      message: "invalid token",
    });
    await expect(createStaffLineSessionAction(input)).resolves.toEqual({
      success: false,
      code: "LINE_AUTH_FAILED",
      message: "invalid token",
    });
    const expiresAt = new Date("2026-10-01T00:00:00.000Z");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: true,
      sessionId: "private-session-id",
      expiresAt,
    });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: true,
      user,
    });
    const result = await createStaffLineSessionAction(input);
    expect(result).toMatchObject({ success: true, user });
    expect(result).not.toHaveProperty("sessionId");
    expect(Object.keys(result).sort()).toEqual(["success", "user"]);
    expect(mocks.setCookie).toHaveBeenCalledWith(
      "private-session-id",
      expiresAt,
    );
  });

  test("LINE service unavailable の reason だけを安全に記録し、clientへ返さない", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: false,
      code: "LINE_SERVICE_UNAVAILABLE",
      reason: "timeout",
      message: "LINE認証サービスを利用できません。",
    });

    await expect(createStaffLineSessionAction(input)).resolves.toEqual({
      success: false,
      code: "LINE_SERVICE_UNAVAILABLE",
      message: "LINE認証サービスを利用できません。",
    });
    expect(mocks.reportLineServiceUnavailable).toHaveBeenCalledWith(
      "auth.action.create_staff_session",
      "timeout",
    );
    expect(mocks.reportLineServiceUnavailable).toHaveBeenCalledTimes(1);
    expect(mocks.reportUnexpectedServerException).not.toHaveBeenCalled();
  });

  test("LINE_AUTH_FAILED はLINE service unavailableとして記録しない", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: false,
      code: "LINE_AUTH_FAILED",
      message: "invalid token",
    });

    await createStaffLineSessionAction(input);

    expect(mocks.reportLineServiceUnavailable).not.toHaveBeenCalled();
  });

  test("reasonのないLINE_SERVICE_UNAVAILABLEは推測して記録しない", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: false,
      code: "LINE_SERVICE_UNAVAILABLE",
      message: "LINE認証サービスを利用できません。",
    });

    await createStaffLineSessionAction(input);

    expect(mocks.reportLineServiceUnavailable).not.toHaveBeenCalled();
  });

  test("admin action は server-side authorizeActiveAdmin を通す", async () => {
    const { createAdminLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: true,
      sessionId: "session",
      expiresAt: new Date(),
    });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: true,
      user,
    });
    mocks.authorizeActiveAdmin.mockReturnValueOnce({
      ok: false,
      code: "ADMIN_ACCESS_REQUIRED",
    } as never);
    await expect(createAdminLineSessionAction(input)).resolves.toMatchObject({
      success: false,
      code: "ADMIN_ACCESS_REQUIRED",
    });
    expect(mocks.authorizeActiveAdmin).toHaveBeenCalled();
  });

  test("unexpected exception は generic failure と observability になる", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    const error = new Error("secret token must not leak");
    mocks.authenticateWithLine.mockRejectedValueOnce(error);
    await expect(createStaffLineSessionAction(input)).resolves.toEqual({
      success: false,
      code: "SESSION_CREATION_FAILED",
      message: "ログイン処理に失敗しました。",
    });
    expect(mocks.reportUnexpectedServerException).toHaveBeenCalledWith(
      error,
      "auth.action.create_staff_session",
    );
    expect(mocks.reportLineServiceUnavailable).not.toHaveBeenCalled();
  });
});
