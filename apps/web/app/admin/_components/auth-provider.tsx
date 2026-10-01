"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { env } from "../../../env";
import type {
  AuthBootstrapState,
  AuthenticatedTimeCardUser,
} from "../../../lib/auth-types";
import { createAdminLineSessionAction } from "../../(staff)/_actions/auth-actions.ts";
import {
  AdminClientError,
  clientErrorFromReadState,
} from "../_lib/admin-action-client.ts";

type AuthState =
  | { status: "checking"; message: string }
  | {
      status: "ready";
      user: AuthenticatedTimeCardUser;
    }
  | { status: "unavailable" | "error"; code?: string; message: string };
type AuthenticationResult = Exclude<AuthState, { status: "checking" }>;

type AuthContextValue = {
  authState: AuthState;
  reauthenticate: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const liffId = env.NEXT_PUBLIC_LIFF_ID;

function stateFromBootstrap(initialAuth: AuthBootstrapState): AuthState {
  if (initialAuth.status === "ready") return initialAuth;
  if (initialAuth.status === "unavailable") return initialAuth;
  if (initialAuth.status === "error") return initialAuth;
  return {
    status: liffId ? "checking" : "error",
    message: liffId
      ? "管理画面を準備しています..."
      : "LIFF IDが未設定です。NEXT_PUBLIC_LIFF_IDを設定してください。",
  };
}

export function AuthProvider({
  children,
  initialAuth,
}: {
  children: ReactNode;
  initialAuth: AuthBootstrapState;
}) {
  const [authState, setAuthState] = useState<AuthState>(() =>
    stateFromBootstrap(initialAuth),
  );
  const authPromiseRef = useRef<Promise<AuthenticationResult> | null>(null);
  const bootstrapStartedRef = useRef(false);
  const bootstrapRefreshRef = useRef(false);
  const mountedRef = useRef(true);
  const router = useRouter();

  const authenticate = useCallback(async (): Promise<AuthenticationResult> => {
    if (!liffId) {
      const state = {
        status: "error",
        message: "LIFF IDが未設定です。NEXT_PUBLIC_LIFF_IDを設定してください。",
      } satisfies AuthenticationResult;
      setAuthState(state);
      return state;
    }

    let liff: typeof import("@line/liff")["default"];
    try {
      ({ default: liff } = await import("@line/liff"));
      await liff.init({ liffId, withLoginOnExternalBrowser: true });
    } catch {
      const state = {
        status: "error",
        message:
          "LIFFの初期化に失敗しました。LIFF IDとLINE設定を確認してください。",
      } satisfies AuthenticationResult;
      setAuthState(state);
      return state;
    }

    const idToken = liff.getIDToken();
    const accessToken = liff.getAccessToken();
    if (!idToken && !accessToken) {
      const state = {
        status: "error",
        message:
          "LINE認証情報を取得できませんでした。LINEアプリから開き直してください。",
      } satisfies AuthenticationResult;
      setAuthState(state);
      return state;
    }

    try {
      const session = await createAdminLineSessionAction({
        idToken,
        accessToken,
      });
      if (session.success) {
        const state = {
          status: "ready",
          user: session.user,
        } satisfies AuthenticationResult;
        setAuthState(state);
        return state;
      }
      const state = {
        status:
          session.code === "ADMIN_ACCESS_REQUIRED" ||
          session.code === "ACTOR_NOT_ACTIVE"
            ? "unavailable"
            : "error",
        code: session.code,
        message:
          session.code === "LINE_AUTH_REQUIRED" ||
          session.code === "LINE_AUTH_FAILED"
            ? `LINE認証に失敗しました。${session.message}`
            : session.message,
      } satisfies AuthenticationResult;
      setAuthState(state);
      return state;
    } catch {
      const state = {
        status: "error",
        message: "認証処理に失敗しました。",
      } satisfies AuthenticationResult;
      setAuthState(state);
      return state;
    }
  }, []);

  const runAuthentication =
    useCallback(async (): Promise<AuthenticationResult> => {
      if (authPromiseRef.current) return authPromiseRef.current;
      setAuthState({
        status: "checking",
        message: "管理画面を準備しています...",
      });
      const promise = authenticate();
      authPromiseRef.current = promise;
      try {
        return await promise;
      } finally {
        if (authPromiseRef.current === promise) authPromiseRef.current = null;
      }
    }, [authenticate]);

  useEffect(() => {
    mountedRef.current = true;
    if (initialAuth.status === "missing" && !bootstrapStartedRef.current) {
      bootstrapStartedRef.current = true;
      void runAuthentication()
        .then((result) => {
          if (result.status === "ready" && !bootstrapRefreshRef.current) {
            bootstrapRefreshRef.current = true;
            router.refresh();
          }
        })
        .catch(() => undefined);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [initialAuth.status, router, runAuthentication]);

  const reauthenticate = useCallback(async (): Promise<void> => {
    if (!mountedRef.current)
      throw new AdminClientError(
        "認証プロバイダーがアンマウントされています。",
      );
    const result = await runAuthentication();
    if (result.status === "ready") return;
    throw clientErrorFromReadState(result);
  }, [runAuthentication]);

  return (
    <AuthContext.Provider value={{ authState, reauthenticate }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
