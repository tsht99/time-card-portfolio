import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useStaffAuth } from "../app/(staff)/_hooks/use-staff-auth.ts";
import type { AuthBootstrapState } from "../lib/auth-types";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  liff: {
    init: vi.fn(async () => undefined),
    getIDToken: vi.fn(() => "test-id-token"),
    getAccessToken: vi.fn(() => "test-access-token"),
  },
}));

vi.mock("../env", () => ({
  env: { NEXT_PUBLIC_LIFF_ID: "test-liff-id" },
}));
vi.mock("@line/liff", () => ({ default: mocks.liff }));
vi.mock("../app/(staff)/_actions/auth-actions.ts", () => ({
  createStaffLineSessionAction: mocks.createSession,
}));

const readyAuth = {
  status: "ready",
  user: {
    userId: "staff-1",
    displayName: "スタッフ",
    role: "staff",
    status: "active",
  },
} satisfies AuthBootstrapState;

const missingAuth = {
  status: "missing",
  message: "ログインが必要です。",
} satisfies AuthBootstrapState;

afterEach(() => {
  mocks.createSession.mockReset();
  mocks.liff.init.mockReset();
  mocks.liff.init.mockResolvedValue(undefined);
  mocks.liff.getIDToken.mockClear();
  mocks.liff.getAccessToken.mockClear();
});

describe("useStaffAuth", () => {
  test("ready の初期認証ではLIFFとStaff sessionを初期化しない", () => {
    const onAuthenticated = vi.fn();
    const { result } = renderHook(() =>
      useStaffAuth({ initialAuth: readyAuth, onAuthenticated }),
    );

    expect(result.current.authStatus).toBe("ready");
    expect(result.current.authMessage).toBe("認証が完了しました。");
    expect(mocks.liff.init).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  test("missing の初回描画は認証確認中として中立的に表示する", () => {
    mocks.createSession.mockReturnValue(new Promise(() => undefined));
    const onAuthenticated = vi.fn();
    const { result } = renderHook(() =>
      useStaffAuth({ initialAuth: missingAuth, onAuthenticated }),
    );

    expect(result.current.authStatus).toBe("checking");
    expect(result.current.authMessage).toBe("ログイン状態を確認しています。");
  });

  test("missing の初期認証はLIFF session作成後に認証成功を通知する", async () => {
    mocks.createSession.mockResolvedValue({
      success: true,
      user: readyAuth.user,
    });
    const onAuthenticated = vi.fn();
    const { result } = renderHook(() =>
      useStaffAuth({ initialAuth: missingAuth, onAuthenticated }),
    );

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1));
    expect(mocks.liff.init).toHaveBeenCalledWith({
      liffId: "test-liff-id",
      withLoginOnExternalBrowser: true,
    });
    expect(mocks.createSession).toHaveBeenCalledWith({
      idToken: "test-id-token",
      accessToken: "test-access-token",
    });
    expect(result.current.authStatus).not.toBe("ready");
    expect(result.current.authMessage).toBe("認証が完了しました。");
  });

  test.each([
    ["USER_PENDING", "管理者の承認待ちです。", "pending"],
    ["USER_INACTIVE", "利用停止です。", "inactive"],
    ["LINE_AUTH_FAILED", "LINE認証に失敗しました。", "error"],
  ] as const)(
    "missing session の %s は %s として分類する",
    async (code, message, expectedStatus) => {
      mocks.createSession.mockResolvedValue({
        success: false,
        code,
        message,
      });
      const onAuthenticated = vi.fn();
      const { result } = renderHook(() =>
        useStaffAuth({ initialAuth: missingAuth, onAuthenticated }),
      );

      await waitFor(() =>
        expect(result.current.authStatus).toBe(expectedStatus),
      );
      expect(result.current.authMessage).toBe(message);
    },
  );

  test.each(["liff", "session"] as const)(
    "%s 初期化処理のthrowは共通の認証エラーにする",
    async (failurePoint) => {
      if (failurePoint === "liff") {
        mocks.liff.init.mockRejectedValueOnce(new Error("LIFF error"));
      } else {
        mocks.createSession.mockRejectedValueOnce(new Error("session error"));
      }
      const onAuthenticated = vi.fn();
      const { result } = renderHook(() =>
        useStaffAuth({ initialAuth: missingAuth, onAuthenticated }),
      );

      await waitFor(() => expect(result.current.authStatus).toBe("error"));
      expect(result.current.authMessage).toBe("認証処理に失敗しました。");
    },
  );

  test("reauthenticate は同時呼び出しをsingle-flightにする", async () => {
    let resolveInit!: () => void;
    mocks.liff.init.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveInit = () => resolve(undefined);
        }),
    );
    mocks.createSession.mockResolvedValue({
      success: true,
      user: readyAuth.user,
    });
    const onAuthenticated = vi.fn();
    const { result } = renderHook(() =>
      useStaffAuth({ initialAuth: readyAuth, onAuthenticated }),
    );

    let pending!: [
      ReturnType<typeof result.current.reauthenticate>,
      ReturnType<typeof result.current.reauthenticate>,
    ];
    act(() => {
      pending = [
        result.current.reauthenticate(),
        result.current.reauthenticate(),
      ];
    });
    await waitFor(() => expect(mocks.liff.init).toHaveBeenCalledTimes(1));
    expect(mocks.createSession).not.toHaveBeenCalled();

    resolveInit();
    const [firstResult, secondResult] = await act(async () =>
      Promise.all(pending),
    );
    expect(mocks.liff.init).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult).toEqual({ success: true, user: readyAuth.user });
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});
