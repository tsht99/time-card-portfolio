import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import { AdminClientError } from "../_lib/admin-action-client.ts";
import { AuthProvider, useAuth } from "./auth-provider.tsx";

const mocks = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  getIDToken: vi.fn(() => "id-token"),
  getAccessToken: vi.fn(() => "access-token"),
  createAdminLineSessionAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../../../env", () => ({
  env: { NEXT_PUBLIC_LIFF_ID: "test-liff-id" },
}));
vi.mock("@line/liff", () => ({
  default: {
    init: mocks.init,
    getIDToken: mocks.getIDToken,
    getAccessToken: mocks.getAccessToken,
  },
}));
vi.mock("../../(staff)/_actions/auth-actions.ts", () => ({
  createAdminLineSessionAction: mocks.createAdminLineSessionAction,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const ready = {
  status: "ready",
  user: {
    userId: "admin-1",
    displayName: "管理者",
    role: "admin",
    status: "active",
  },
} satisfies AuthBootstrapState;

function Probe({
  onReauthenticate,
}: {
  onReauthenticate?: (reauthenticate: () => Promise<void>) => void;
}) {
  const { authState, reauthenticate } = useAuth();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    onReauthenticate?.(reauthenticate);
  }, [onReauthenticate, reauthenticate]);
  return (
    <>
      <output data-testid="status">{authState.status}</output>
      {authState.status !== "ready" && (
        <output data-testid="auth-message">{authState.message}</output>
      )}
      {authState.status === "ready" && (
        <output data-testid="user">{authState.user.userId}</output>
      )}
      <button
        type="button"
        onClick={() =>
          void reauthenticate()
            .then(() => {
              document.body.dataset.reauthenticated = "true";
            })
            .catch(setError)
        }
      >
        reauthenticate
      </button>
      <button
        type="button"
        onClick={() =>
          void Promise.all([reauthenticate(), reauthenticate()]).catch(setError)
        }
      >
        reauthenticate twice
      </button>
      {error instanceof AdminClientError && (
        <>
          <output data-testid="error-name">{error.name}</output>
          <output data-testid="error-message">{error.message}</output>
          <output data-testid="error-code">{error.code}</output>
          <output data-testid="error-kind">{error.kind}</output>
        </>
      )}
    </>
  );
}

afterEach(() => {
  mocks.init.mockReset();
  mocks.init.mockResolvedValue(undefined);
  mocks.getIDToken.mockReset();
  mocks.getIDToken.mockReturnValue("id-token");
  mocks.getAccessToken.mockReset();
  mocks.getAccessToken.mockReturnValue("access-token");
  mocks.createAdminLineSessionAction.mockReset();
  mocks.refresh.mockReset();
  delete document.body.dataset.reauthenticated;
});

describe("Task 5 admin AuthProvider", () => {
  test("initial ready / unavailable では LIFF と action を呼ばない", async () => {
    const { unmount } = render(
      <AuthProvider initialAuth={ready}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("status").textContent).toBe("ready");
    await Promise.resolve();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.createAdminLineSessionAction).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    unmount();
    render(
      <AuthProvider
        initialAuth={{
          status: "unavailable",
          code: "ADMIN_ACCESS_REQUIRED",
          message: "権限なし",
        }}
      >
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("status").textContent).toBe("unavailable");
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.createAdminLineSessionAction).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  test("missing の場合だけ LIFF と Server Action を実行する", async () => {
    mocks.createAdminLineSessionAction.mockResolvedValueOnce({
      success: true,
      user: ready.user,
    });
    render(
      <AuthProvider
        initialAuth={{ status: "missing", message: "ログインが必要です。" }}
      >
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    expect(mocks.init).toHaveBeenCalledWith({
      liffId: "test-liff-id",
      withLoginOnExternalBrowser: true,
    });
    expect(mocks.createAdminLineSessionAction).toHaveBeenCalledWith({
      idToken: "id-token",
      accessToken: "access-token",
    });
    expect(screen.getByTestId("user").textContent).toBe("admin-1");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  test("reauthenticate は成功時にresolveし、同時実行をcoalesceする", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.createAdminLineSessionAction.mockImplementation(async () => {
      await pending;
      return { success: true, user: ready.user };
    });
    render(
      <AuthProvider initialAuth={ready}>
        <Probe />
      </AuthProvider>,
    );
    screen.getByRole("button", { name: "reauthenticate twice" }).click();
    await waitFor(() =>
      expect(mocks.createAdminLineSessionAction).toHaveBeenCalledTimes(1),
    );
    release();
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("admin-1"),
    );
    screen.getByRole("button", { name: "reauthenticate" }).click();
    await waitFor(() =>
      expect(document.body.dataset.reauthenticated).toBe("true"),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  test.each([
    {
      code: "ADMIN_ACCESS_REQUIRED",
      message: "権限なし",
    },
    {
      code: "ACTOR_NOT_ACTIVE",
      message: "利用停止",
    },
  ] as const)(
    "unavailable の再認証失敗を AdminClientError として伝播する ($code)",
    async ({ code, message }) => {
      mocks.createAdminLineSessionAction.mockResolvedValueOnce({
        success: false,
        code,
        message,
      });
      render(
        <AuthProvider initialAuth={ready}>
          <Probe />
        </AuthProvider>,
      );

      screen.getByRole("button", { name: "reauthenticate" }).click();
      await waitFor(() =>
        expect(screen.getByTestId("status").textContent).toBe("unavailable"),
      );
      await waitFor(() =>
        expect(screen.getByTestId("error-name").textContent).toBe(
          "AdminClientError",
        ),
      );
      expect(screen.getByTestId("auth-message").textContent).toBe(message);
      expect(screen.getByTestId("error-message").textContent).toBe(message);
      expect(screen.getByTestId("error-code").textContent).toBe(code);
      expect(screen.getByTestId("error-kind").textContent).toBe(
        "authorization",
      );
    },
  );

  test("error の再認証失敗は code と既存メッセージを保ち、権限エラーにしない", async () => {
    mocks.createAdminLineSessionAction.mockResolvedValueOnce({
      success: false,
      code: "LINE_AUTH_FAILED",
      message: "LINE側の認証エラー",
    });
    render(
      <AuthProvider initialAuth={ready}>
        <Probe />
      </AuthProvider>,
    );

    screen.getByRole("button", { name: "reauthenticate" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("error-name").textContent).toBe(
        "AdminClientError",
      ),
    );
    expect(screen.getByTestId("auth-message").textContent).toBe(
      "LINE認証に失敗しました。LINE側の認証エラー",
    );
    expect(screen.getByTestId("error-message").textContent).toBe(
      "LINE認証に失敗しました。LINE側の認証エラー",
    );
    expect(screen.getByTestId("error-code").textContent).toBe(
      "LINE_AUTH_FAILED",
    );
    expect(screen.getByTestId("error-kind").textContent).toBe("generic");
  });

  test("アンマウント後の再認証は AdminClientError として reject する", async () => {
    let reauthenticate: (() => Promise<void>) | undefined;
    const { unmount } = render(
      <AuthProvider initialAuth={ready}>
        <Probe onReauthenticate={(value) => (reauthenticate = value)} />
      </AuthProvider>,
    );
    expect(reauthenticate).toBeDefined();
    unmount();

    await expect(reauthenticate?.()).rejects.toMatchObject({
      name: "AdminClientError",
      message: "認証プロバイダーがアンマウントされています。",
      code: undefined,
      kind: "generic",
    });
  });
});
