import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateWithLine: vi.fn(),
  authenticateAdminWithLine: vi.fn(),
  resolveActiveSession: vi.fn(),
  resolveActiveAdminSession: vi.fn(),
  setCookie: vi.fn(),
  reportUnexpectedServerException: vi.fn(),
  reportLineServiceUnavailable: vi.fn(),
}));
vi.mock("../../../lib/server/auth-session", () => ({
  setTimeCardSessionCookie: mocks.setCookie,
}));
vi.mock("../../../lib/server/users-composition", () => ({
  createTimeCardAuthenticationApplication: vi.fn(() => ({
    authenticateWithLine: mocks.authenticateWithLine,
    authenticateAdminWithLine: mocks.authenticateAdminWithLine,
    resolveActiveSession: mocks.resolveActiveSession,
    resolveActiveAdminSession: mocks.resolveActiveAdminSession,
  })),
}));
vi.mock("../../../lib/server/server-observability", () => ({
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

async function callAction(action: unknown, input: unknown) {
  if (typeof action !== "function")
    throw new TypeError("Expected action function");
  return action(input);
}

describe("Task 5 LINE session Server Actions", () => {
  test("unknown input は strict validation で拒否する", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    await expect(
      callAction(createStaffLineSessionAction, { ...input, extra: true }),
    ).resolves.toMatchObject({ validationErrors: expect.anything() });
    expect(mocks.authenticateWithLine).not.toHaveBeenCalled();
  });

  test("typed failure を維持し、成功結果から credential を露出しない", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: false,
      code: "LINE_AUTH_FAILED",
      message: "invalid token",
    });
    await expect(
      callAction(createStaffLineSessionAction, input),
    ).resolves.toEqual({
      serverError: { code: "LINE_AUTH_FAILED", message: "invalid token" },
    });
    const expiresAt = new Date("2026-10-01T00:00:00.000Z");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: true,
      credential: "a".repeat(43),
      expiresAt,
    });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: true,
      user,
    });
    const result = await callAction(createStaffLineSessionAction, input);
    expect(result).toMatchObject({ data: user });
    expect(result).not.toHaveProperty("credential");
    expect(Object.keys(result).sort()).toEqual(["data"]);
    expect(mocks.setCookie).toHaveBeenCalledWith("a".repeat(43), expiresAt);
    expect(mocks.resolveActiveSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setCookie.mock.invocationCallOrder[0],
    );
  });

  test("session 解決に失敗した場合は Cookie を発行しない", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: true,
      credential: "a".repeat(43),
      expiresAt: new Date(),
    });
    mocks.resolveActiveSession.mockResolvedValueOnce({
      ok: false,
      code: "SESSION_EXPIRED",
    });

    await expect(
      callAction(createStaffLineSessionAction, input),
    ).resolves.toMatchObject({
      serverError: { code: "SESSION_CREATION_FAILED" },
    });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  test("LINE service unavailable の reason だけを安全に記録し、clientへ返さない", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: false,
      code: "LINE_SERVICE_UNAVAILABLE",
      reason: "timeout",
      message: "LINE認証サービスを利用できません。",
    });

    await expect(
      callAction(createStaffLineSessionAction, input),
    ).resolves.toEqual({
      serverError: {
        code: "LINE_SERVICE_UNAVAILABLE",
        message: "LINE認証サービスを利用できません。",
      },
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

    await callAction(createStaffLineSessionAction, input);

    expect(mocks.reportLineServiceUnavailable).not.toHaveBeenCalled();
  });

  test("reasonのないLINE_SERVICE_UNAVAILABLEは推測して記録しない", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateWithLine.mockResolvedValueOnce({
      ok: false,
      code: "LINE_SERVICE_UNAVAILABLE",
      message: "LINE認証サービスを利用できません。",
    });

    await callAction(createStaffLineSessionAction, input);

    expect(mocks.reportLineServiceUnavailable).not.toHaveBeenCalled();
  });

  test("admin action は Application で管理者 session を検証する", async () => {
    const { createAdminLineSessionAction } = await import("./auth-actions.ts");
    mocks.authenticateAdminWithLine.mockResolvedValueOnce({
      ok: true,
      credential: "a".repeat(43),
      expiresAt: new Date(),
    });
    mocks.resolveActiveAdminSession.mockResolvedValueOnce({
      ok: false,
      code: "ADMIN_ACCESS_REQUIRED",
    });
    await expect(
      callAction(createAdminLineSessionAction, input),
    ).resolves.toMatchObject({
      serverError: { code: "ADMIN_ACCESS_REQUIRED" },
    });
    expect(mocks.resolveActiveAdminSession).toHaveBeenCalledWith(
      "a".repeat(43),
    );
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  test("admin の認可成功後に検証済み credential を Cookie に設定する", async () => {
    const { createAdminLineSessionAction } = await import("./auth-actions.ts");
    const credential = "a".repeat(43);
    const expiresAt = new Date("2026-10-01T00:00:00.000Z");
    mocks.authenticateAdminWithLine.mockResolvedValueOnce({
      ok: true,
      credential,
      expiresAt,
    });
    mocks.resolveActiveAdminSession.mockResolvedValueOnce({ ok: true, user });

    const result = await callAction(createAdminLineSessionAction, input);

    expect(result).toEqual({ data: user });
    expect(result).not.toHaveProperty("credential");
    expect(mocks.setCookie).toHaveBeenCalledWith(credential, expiresAt);
    expect(
      mocks.resolveActiveAdminSession.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.setCookie.mock.invocationCallOrder[0]);
  });

  test("unexpected exception は generic failure と observability になる", async () => {
    const { createStaffLineSessionAction } = await import("./auth-actions.ts");
    const error = new Error("secret token must not leak");
    mocks.authenticateWithLine.mockRejectedValueOnce(error);
    await expect(
      callAction(createStaffLineSessionAction, input),
    ).resolves.toEqual({
      serverError: {
        code: "INTERNAL_SERVER_ERROR",
        message: "ログイン処理に失敗しました。",
      },
    });
    expect(mocks.reportUnexpectedServerException).toHaveBeenCalledWith(
      error,
      "auth.action.create_staff_session",
    );
    expect(mocks.reportLineServiceUnavailable).not.toHaveBeenCalled();
  });
});
