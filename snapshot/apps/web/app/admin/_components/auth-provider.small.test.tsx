import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import {
  AdminClientError,
  runAdminAction,
} from "../_lib/admin-action-client.ts";
import { AdminRouteDataReadiness } from "./admin-route-data-readiness.tsx";
import { AuthProvider, useAuth } from "./auth-provider.tsx";

const mocks = vi.hoisted(() => ({
  init: vi.fn(async () => undefined),
  getIDToken: vi.fn(() => "id-token"),
  getAccessToken: vi.fn(() => "access-token"),
  createAdminLineSessionAction: vi.fn(),
  refresh: vi.fn(),
  pathname: "/admin/test",
}));

vi.mock("../../../env", () => ({
  env: {
    NEXT_PUBLIC_LIFF_ID: "test-liff-id",
    NEXT_PUBLIC_HELP_URL: "https://help.example.test",
  },
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
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
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
  mutation,
  serverData,
  serverRenderId = "initial",
  routeDataToken = `route:${serverRenderId}`,
  routeReady = true,
}: {
  onReauthenticate?: (reauthenticate: () => Promise<void>) => void;
  mutation?: () => Promise<unknown>;
  serverData?: string;
  serverRenderId?: string;
  routeDataToken?: string;
  routeReady?: boolean;
}) {
  const {
    authState,
    isSubjectCurrent,
    isRouteDataReady,
    refreshFailure,
    canMutate,
    reauthenticate,
  } = useAuth();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    onReauthenticate?.(reauthenticate);
  }, [onReauthenticate, reauthenticate]);
  return (
    <AdminRouteDataReadiness routeDataToken={routeDataToken} ready={routeReady}>
      <output data-testid="status">{authState.status}</output>
      <output data-testid="subject-current">{String(isSubjectCurrent)}</output>
      <output data-testid="route-data-ready">{String(isRouteDataReady)}</output>
      <output data-testid="refresh-failure-code">
        {refreshFailure?.code ?? ""}
      </output>
      <output data-testid="server-data">{serverData}</output>
      <label>
        draft
        <input aria-label="draft" defaultValue="入力中の下書き" />
      </label>
      {authState.status !== "ready" && (
        <output data-testid="auth-message">{authState.message}</output>
      )}
      {authState.status === "ready" && (
        <output data-testid="user">{authState.user.userId}</output>
      )}
      {mutation && (
        <>
          <button
            type="button"
            disabled={!isSubjectCurrent}
            onClick={() =>
              void runAdminAction(mutation, reauthenticate, canMutate).catch(
                setError,
              )
            }
          >
            mutate
          </button>
          <button
            type="button"
            onClick={() =>
              void runAdminAction(mutation, reauthenticate, canMutate).catch(
                setError,
              )
            }
          >
            invoke guarded mutation
          </button>
        </>
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
    </AdminRouteDataReadiness>
  );
}

beforeEach(() => {
  window.history.replaceState({}, "", mocks.pathname);
});

afterEach(() => {
  vi.useRealTimers();
  mocks.init.mockReset();
  mocks.pathname = "/admin/test";
  window.history.replaceState({}, "", "/");
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
      data: ready.user,
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

  test("LIFF token getter exception後に待機を解放し、再認証を再試行できる", async () => {
    mocks.getIDToken
      .mockImplementationOnce(() => {
        throw new Error("LIFF token unavailable");
      })
      .mockReturnValue("id-token");
    mocks.createAdminLineSessionAction.mockResolvedValue({ data: ready.user });
    const { rerender } = render(
      <AuthProvider initialAuth={ready} serverRenderId="before-retry">
        <Probe serverRenderId="before-retry" />
      </AuthProvider>,
    );

    screen.getByRole("button", { name: "reauthenticate" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
    expect(screen.getByTestId("auth-message").textContent).toContain(
      "LINE認証情報を取得できませんでした",
    );
    expect(mocks.createAdminLineSessionAction).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "reauthenticate" }).click();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.createAdminLineSessionAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "reauthenticate" })).toBeTruthy();

    rerender(
      <AuthProvider initialAuth={ready} serverRenderId="after-retry">
        <Probe serverData="fresh data" serverRenderId="after-retry" />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(document.body.dataset.reauthenticated).toBe("true"),
    );
    expect(screen.getByTestId("server-data").textContent).toBe("fresh data");
  });

  test("通常の認証 action exception後も次の再認証を実行できる", async () => {
    mocks.createAdminLineSessionAction
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ data: ready.user });
    render(
      <AuthProvider initialAuth={ready}>
        <Probe />
      </AuthProvider>,
    );

    screen.getByRole("button", { name: "reauthenticate" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("auth-message").textContent).toBe(
        "認証処理に失敗しました。",
      ),
    );
    screen.getByRole("button", { name: "reauthenticate" }).click();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.createAdminLineSessionAction).toHaveBeenCalledTimes(2);
  });

  test("same-subject refresh stays blocked until a new server render arrives; retry is explicit", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({
        serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
      })
      .mockResolvedValueOnce({ data: "saved" });
    mocks.createAdminLineSessionAction.mockResolvedValue({ data: ready.user });
    const { rerender } = render(
      <AuthProvider initialAuth={ready} serverRenderId="render-1">
        <Probe
          mutation={mutation}
          serverData="old server data"
          serverRenderId="render-1"
        />
      </AuthProvider>,
    );

    screen.getByRole("button", { name: "mutate" }).click();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("subject-current").textContent).toBe("false");
    expect(screen.getByRole("button", { name: "mutate" })).toHaveProperty(
      "disabled",
      true,
    );

    rerender(
      <AuthProvider initialAuth={ready} serverRenderId="render-2">
        <Probe
          mutation={mutation}
          serverData="refreshed server data"
          serverRenderId="render-2"
        />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("subject-current").textContent).toBe("true"),
    );
    expect(screen.getByTestId("server-data").textContent).toBe(
      "refreshed server data",
    );
    expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe(
      "入力中の下書き",
    );
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("error-code").textContent).toBe(
      "MUTATION_NOT_PERFORMED_REAUTHENTICATED",
    );

    screen.getByRole("button", { name: "mutate" }).click();
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
  });

  test("templateとrouteのtokenが異なっても初回mutationでき、soft navigation中は新route dataを待つ", async () => {
    const mutation = vi.fn().mockResolvedValue({ data: "saved" });
    window.history.replaceState({}, "", "/admin/test");
    const { rerender } = render(
      <AuthProvider
        initialAuth={ready}
        serverRenderId="template-token-a"
        diagnostics
      >
        <Probe mutation={mutation} routeDataToken="page-token-a" />
      </AuthProvider>,
    );
    const diagnostic = screen.getByTestId("admin-route-readiness-diagnostic");
    expect(diagnostic.getAttribute("data-provider-render-id")).toBe(
      "template-token-a",
    );
    expect(diagnostic.getAttribute("data-route-data-token")).toBe(
      "page-token-a",
    );
    expect(diagnostic.getAttribute("data-ready")).toBe("true");
    screen.getByRole("button", { name: "mutate" }).click();
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));

    mocks.pathname = "/admin/users/staff-1";
    window.history.pushState({}, "", "/admin/users/staff-1");
    rerender(
      <AuthProvider
        initialAuth={ready}
        serverRenderId="template-token-a"
        diagnostics
      >
        <Probe mutation={mutation} routeDataToken="page-token-a" />
      </AuthProvider>,
    );
    screen.getByRole("button", { name: "invoke guarded mutation" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("error-code").textContent).toBe(
        "SERVER_DATA_REFRESH_PENDING",
      ),
    );
    expect(mutation).toHaveBeenCalledTimes(1);

    rerender(
      <AuthProvider
        initialAuth={ready}
        serverRenderId="template-token-a"
        diagnostics
      >
        <Probe mutation={mutation} routeDataToken="page-token-b" />
      </AuthProvider>,
    );
    screen.getByRole("button", { name: "mutate" }).click();
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
  });

  test("auth action中に新しいserver renderが届いたらwaiterを解決して余分なrefreshをしない", async () => {
    let resolveAuth!: (result: { data: typeof ready.user }) => void;
    mocks.createAdminLineSessionAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        }),
    );
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({
        serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
      })
      .mockResolvedValueOnce({ data: "saved" });
    const { rerender } = render(
      <AuthProvider initialAuth={ready} serverRenderId="render-before-auth">
        <Probe
          mutation={mutation}
          serverData="old data"
          serverRenderId="render-before-auth"
        />
      </AuthProvider>,
    );

    screen.getByRole("button", { name: "mutate" }).click();
    await waitFor(() =>
      expect(mocks.createAdminLineSessionAction).toHaveBeenCalledTimes(1),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "mutate" })).toHaveProperty(
      "disabled",
      true,
    );

    rerender(
      <AuthProvider
        initialAuth={ready}
        serverRenderId="render-from-auth-action"
      >
        <Probe
          mutation={mutation}
          serverData="fresh data from auth response"
          serverRenderId="render-from-auth-action"
        />
      </AuthProvider>,
    );
    expect(screen.getByRole("button", { name: "mutate" })).toHaveProperty(
      "disabled",
      true,
    );
    resolveAuth({ data: ready.user });

    await waitFor(() =>
      expect(screen.getByTestId("error-code").textContent).toBe(
        "MUTATION_NOT_PERFORMED_REAUTHENTICATED",
      ),
    );
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("server-data").textContent).toBe(
      "fresh data from auth response",
    );
    expect(screen.getByRole("button", { name: "mutate" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  test("新しいroute tokenだけでは古いserver render dataを最新扱いしない", async () => {
    mocks.createAdminLineSessionAction.mockResolvedValue({ data: ready.user });
    const { rerender } = render(
      <AuthProvider initialAuth={ready} serverRenderId="same-render">
        <Probe serverData="old data" serverRenderId="same-render" />
      </AuthProvider>,
    );

    screen.getByRole("button", { name: "reauthenticate" }).click();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    rerender(
      <AuthProvider initialAuth={ready} serverRenderId="same-render">
        <Probe
          serverData="route token changed only"
          serverRenderId="same-render"
          routeDataToken="new-route-token"
        />
      </AuthProvider>,
    );
    expect(document.body.dataset.reauthenticated).toBeUndefined();
    expect(screen.getByTestId("subject-current").textContent).toBe("false");

    rerender(
      <AuthProvider initialAuth={ready} serverRenderId="new-render">
        <Probe
          serverData="fresh server data"
          serverRenderId="new-render"
          routeDataToken="new-route-token"
        />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(document.body.dataset.reauthenticated).toBe("true"),
    );
    expect(screen.getByTestId("server-data").textContent).toBe(
      "fresh server data",
    );
  });

  test("新しいrenderの業務データ取得に失敗した場合は、再取得が成功するまでmutationを止める", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({
        serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
      })
      .mockResolvedValueOnce({ data: "saved" });
    mocks.createAdminLineSessionAction.mockResolvedValue({ data: ready.user });
    const { rerender } = render(
      <AuthProvider initialAuth={ready} serverRenderId="read-1">
        <Probe mutation={mutation} serverRenderId="read-1" />
      </AuthProvider>,
    );
    const draft = screen.getByLabelText("draft") as HTMLInputElement;
    await userEvent.setup().type(draft, " 追加入力");
    screen.getByRole("button", { name: "mutate" }).click();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));

    rerender(
      <AuthProvider initialAuth={ready} serverRenderId="failed-read">
        <Probe
          mutation={mutation}
          serverRenderId="failed-read"
          routeReady={false}
        />
      </AuthProvider>,
    );
    expect(screen.getByRole("button", { name: "mutate" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByTestId("subject-current").textContent).toBe("false");
    expect(screen.getByTestId("route-data-ready").textContent).toBe("false");
    expect(draft.value).toBe("入力中の下書き 追加入力");
    expect(mutation).toHaveBeenCalledTimes(1);

    rerender(
      <AuthProvider initialAuth={ready} serverRenderId="failed-read-retry">
        <Probe
          mutation={mutation}
          serverData="another failed route render"
          serverRenderId="failed-read-retry"
          routeReady={false}
        />
      </AuthProvider>,
    );
    expect(screen.getByTestId("server-data").textContent).toBe(
      "another failed route render",
    );
    expect(screen.getByRole("button", { name: "mutate" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(draft.value).toBe("入力中の下書き 追加入力");
    screen.getByRole("button", { name: "invoke guarded mutation" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("error-code").textContent).toBe(
        "SERVER_DATA_REFRESH_PENDING",
      ),
    );
    expect(mutation).toHaveBeenCalledTimes(1);

    rerender(
      <AuthProvider initialAuth={ready} serverRenderId="fresh-read">
        <Probe
          mutation={mutation}
          serverData="fresh route data"
          serverRenderId="fresh-read"
        />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("error-code").textContent).toBe(
        "MUTATION_NOT_PERFORMED_REAUTHENTICATED",
      ),
    );
    expect(screen.getByTestId("subject-current").textContent).toBe("true");
    expect(screen.getByTestId("route-data-ready").textContent).toBe("true");
    expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe(
      "入力中の下書き 追加入力",
    );
    expect(mutation).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "mutate" }).click();
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
  });

  test("server refresh が失敗しても操作をブロックし続ける", async () => {
    const mutation = vi.fn().mockResolvedValue({
      serverError: { code: "SESSION_EXPIRED", message: "期限切れ" },
    });
    mocks.createAdminLineSessionAction.mockResolvedValue({ data: ready.user });
    mocks.refresh.mockImplementation(() => {
      throw new Error("server refresh failed");
    });
    render(
      <AuthProvider initialAuth={ready} serverRenderId="stable-render">
        <Probe mutation={mutation} serverRenderId="stable-render" />
      </AuthProvider>,
    );
    screen.getByRole("button", { name: "mutate" }).click();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "mutate" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByTestId("subject-current").textContent).toBe("false");
    expect(screen.getByTestId("error-code").textContent).toBe(
      "SERVER_DATA_REFRESH_FAILED",
    );
    // A delayed route readiness notification cannot clear a terminal refresh failure.
    await Promise.resolve();
    expect(screen.getByTestId("subject-current").textContent).toBe("false");
  });

  test("same-admin の server data refresh timeout は terminal failure として表示する", async () => {
    vi.useFakeTimers();
    mocks.createAdminLineSessionAction.mockResolvedValue({ data: ready.user });
    const { rerender } = render(
      <AuthProvider initialAuth={ready} serverRenderId="timeout-render">
        <Probe mutation={vi.fn()} serverRenderId="timeout-render" />
      </AuthProvider>,
    );

    screen.getByRole("button", { name: "reauthenticate" }).click();
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByTestId("refresh-failure-code").textContent).toBe(
      "SERVER_DATA_REFRESH_TIMEOUT",
    );
    expect(screen.getByTestId("error-code").textContent).toBe(
      "SERVER_DATA_REFRESH_TIMEOUT",
    );
    expect(screen.getByTestId("subject-current").textContent).toBe("false");
    expect(screen.getByRole("button", { name: "mutate" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    rerender(
      <AuthProvider initialAuth={ready} serverRenderId="late-render">
        <Probe
          mutation={vi.fn()}
          serverData="late server data"
          serverRenderId="late-render"
        />
      </AuthProvider>,
    );
    expect(screen.getByTestId("subject-current").textContent).toBe("false");
    expect(screen.getByTestId("error-code").textContent).toBe(
      "SERVER_DATA_REFRESH_TIMEOUT",
    );
  });

  test("concurrent reauthentication calls share one authentication and refresh wait", async () => {
    let reauthenticate: (() => Promise<void>) | undefined;
    let resolveAuth!: (result: { data: typeof ready.user }) => void;
    mocks.createAdminLineSessionAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        }),
    );
    const { rerender } = render(
      <AuthProvider initialAuth={ready} serverRenderId="concurrent-before">
        <Probe onReauthenticate={(value) => (reauthenticate = value)} />
      </AuthProvider>,
    );
    await waitFor(() => expect(reauthenticate).toBeDefined());
    const first = reauthenticate?.();
    const second = reauthenticate?.();
    await waitFor(() =>
      expect(mocks.createAdminLineSessionAction).toHaveBeenCalledTimes(1),
    );
    resolveAuth({ data: ready.user });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));

    rerender(
      <AuthProvider initialAuth={ready} serverRenderId="concurrent-after">
        <Probe
          onReauthenticate={(value) => (reauthenticate = value)}
          serverRenderId="concurrent-after"
        />
      </AuthProvider>,
    );
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(mocks.createAdminLineSessionAction).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  test("再認証で server session と異なる主体になったら操作を中止して refresh する", async () => {
    mocks.createAdminLineSessionAction.mockResolvedValueOnce({
      data: { ...ready.user, userId: "admin-2", displayName: "別の管理者" },
    });
    render(
      <AuthProvider initialAuth={ready}>
        <Probe />
      </AuthProvider>,
    );

    screen.getByRole("button", { name: "reauthenticate" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("admin-2"),
    );

    expect(screen.getByTestId("subject-current").textContent).toBe("false");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("error-code").textContent).toBe(
      "AUTH_SUBJECT_CHANGED",
    );
    expect(screen.getByTestId("error-kind").textContent).toBe("authorization");
  });

  test("再認証中にserver principalが変わったらwaiterを解放し更新を止める", async () => {
    let resolveAuth!: (result: { data: typeof ready.user }) => void;
    let reauthenticate: (() => Promise<void>) | undefined;
    const mutation = vi.fn().mockResolvedValue({ data: "saved" });
    mocks.createAdminLineSessionAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        }),
    );
    const { rerender } = render(
      <AuthProvider initialAuth={ready} serverRenderId="principal-before">
        <Probe
          mutation={mutation}
          onReauthenticate={(value) => (reauthenticate = value)}
          serverRenderId="principal-before"
        />
      </AuthProvider>,
    );
    await waitFor(() => expect(reauthenticate).toBeDefined());
    const pending = reauthenticate?.();
    await waitFor(() =>
      expect(mocks.createAdminLineSessionAction).toHaveBeenCalledTimes(1),
    );

    const otherPrincipal: AuthBootstrapState = {
      status: "ready",
      user: { ...ready.user, userId: "admin-2", displayName: "別の管理者" },
    };
    rerender(
      <AuthProvider
        initialAuth={otherPrincipal}
        serverRenderId="principal-after"
      >
        <Probe
          mutation={mutation}
          onReauthenticate={(value) => (reauthenticate = value)}
          serverRenderId="principal-after"
        />
      </AuthProvider>,
    );
    await expect(pending).rejects.toMatchObject({
      code: "AUTH_SUBJECT_CHANGED",
      kind: "authorization",
    });
    expect(screen.getByTestId("subject-current").textContent).toBe("false");

    screen.getByRole("button", { name: "invoke guarded mutation" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("error-code").textContent).toBe(
        "SERVER_DATA_REFRESH_PENDING",
      ),
    );
    expect(mutation).not.toHaveBeenCalled();

    resolveAuth({ data: ready.user });
    await Promise.resolve();
    expect(screen.getByTestId("subject-current").textContent).toBe("false");
    expect(mutation).not.toHaveBeenCalled();
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
        serverError: { code, message },
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
      serverError: { code: "LINE_AUTH_FAILED", message: "LINE側の認証エラー" },
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

  test("認証処理中のアンマウントで再認証waiterをrejectして解放する", async () => {
    let reauthenticate: (() => Promise<void>) | undefined;
    mocks.createAdminLineSessionAction.mockImplementation(
      () => new Promise(() => undefined),
    );
    const { unmount } = render(
      <AuthProvider initialAuth={ready}>
        <Probe onReauthenticate={(value) => (reauthenticate = value)} />
      </AuthProvider>,
    );
    const pending = reauthenticate?.();
    await waitFor(() =>
      expect(mocks.createAdminLineSessionAction).toHaveBeenCalledTimes(1),
    );
    unmount();

    await expect(pending).rejects.toMatchObject({
      name: "AdminClientError",
      code: "AUTH_SUBJECT_CHANGED",
      kind: "authorization",
    });
  });
});
