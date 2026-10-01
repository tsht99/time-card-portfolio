import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import { RootAuthClient } from "./root-auth-client.tsx";

const mocks = vi.hoisted(() => {
  const replace = vi.fn();
  return {
    replace,
    router: { replace },
    createSession: vi.fn(),
    liff: {
      init: vi.fn(async () => undefined),
      getIDToken: vi.fn(() => "id-token"),
      getAccessToken: vi.fn(() => "access-token"),
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));
vi.mock("../../../env", () => ({
  env: { NEXT_PUBLIC_LIFF_ID: "test-liff-id" },
}));
vi.mock("@line/liff", () => ({ default: mocks.liff }));
vi.mock("../_actions/auth-actions.ts", () => ({
  createStaffLineSessionAction: mocks.createSession,
}));

const readyAuth = {
  status: "ready" as const,
  user: {
    userId: "staff-1",
    displayName: "スタッフ",
    role: "staff" as const,
    status: "active" as const,
  },
} satisfies AuthBootstrapState;

const missingAuth = {
  status: "missing" as const,
  message: "ログインが必要です。",
} satisfies AuthBootstrapState;

function renderRoot(initialAuth: AuthBootstrapState) {
  return render(<RootAuthClient initialAuth={initialAuth} />);
}

afterEach(() => {
  window.history.replaceState({}, "", "/");
  mocks.replace.mockReset();
  mocks.createSession.mockReset();
  mocks.liff.init.mockReset();
  mocks.liff.init.mockResolvedValue(undefined);
});

describe("root auth client", () => {
  test("未ログイン時は勤怠内容を表示せず認証確認中にする", () => {
    mocks.createSession.mockReturnValue(new Promise(() => undefined));

    renderRoot(missingAuth);

    expect(screen.getByText("認証を確認中")).toBeTruthy();
    expect(screen.getByText("ログイン状態を確認しています。")).toBeTruthy();
    expect(screen.queryByText("出勤")).toBeNull();
    expect(screen.queryByText("退勤")).toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  test("LIFF初期化とsession作成の成功後だけclockへ遷移する", async () => {
    const events: string[] = [];
    let resolveInit!: () => void;
    mocks.liff.init.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          events.push("liff.init");
          resolveInit = () => resolve(undefined);
        }),
    );
    mocks.createSession.mockImplementationOnce(async () => {
      events.push("session");
      return { success: true, user: readyAuth.user };
    });
    mocks.replace.mockImplementationOnce(() => events.push("replace"));

    renderRoot(missingAuth);
    await waitFor(() => expect(mocks.liff.init).toHaveBeenCalledTimes(1));
    expect(mocks.replace).not.toHaveBeenCalled();

    resolveInit();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/clock"));
    expect(events).toEqual(["liff.init", "session", "replace"]);
  });

  test("既存sessionではLIFFとsession作成を行わずclockへ遷移する", async () => {
    renderRoot(readyAuth);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/clock"));
    expect(mocks.liff.init).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  test("既存sessionのLIFF復帰URLでは初期化完了前にURLを変更しない", async () => {
    window.history.replaceState({}, "", "/?liff.state=callback");
    let resolveInit!: () => void;
    mocks.liff.init.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveInit = () => resolve(undefined);
        }),
    );

    renderRoot(readyAuth);
    await waitFor(() => expect(mocks.liff.init).toHaveBeenCalledTimes(1));
    expect(mocks.liff.init).toHaveBeenCalledWith({
      liffId: "test-liff-id",
      withLoginOnExternalBrowser: false,
    });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?liff.state=callback");
    expect(mocks.createSession).not.toHaveBeenCalled();

    resolveInit();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/clock"));
  });

  test.each([
    ["USER_PENDING", "利用承認待ち"],
    ["USER_INACTIVE", "利用停止中"],
    ["LINE_AUTH_FAILED", "認証を確認できません"],
  ] as const)("認証失敗・%sでは遷移しない", async (code, title) => {
    mocks.createSession.mockResolvedValue({
      success: false,
      code,
      message: "認証エラー",
    });

    renderRoot(missingAuth);

    await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  test("初期認証エラーではLIFFを初期化せず遷移しない", () => {
    renderRoot({
      status: "error",
      message: "認証状態を確認できませんでした。",
    });

    expect(screen.getByText("認証状態を確認できませんでした。")).toBeTruthy();
    expect(mocks.liff.init).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  test("既存sessionのLIFF初期化失敗ではエラーを表示して遷移しない", async () => {
    mocks.liff.init.mockRejectedValueOnce(new Error("LIFF error"));
    window.history.replaceState({}, "", "/#access_token=secret");

    renderRoot(readyAuth);

    await waitFor(() =>
      expect(screen.getByText("認証処理に失敗しました。")).toBeTruthy(),
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("secret")).toBeNull();
  });
});
