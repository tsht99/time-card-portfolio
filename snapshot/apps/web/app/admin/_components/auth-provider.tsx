"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  serverSubjectUserId: string | null;
  isSubjectCurrent: boolean;
  isRouteDataReady: boolean;
  refreshFailure: AdminClientError | null;
  canMutate: () => boolean;
  reauthenticate: () => Promise<void>;
  serverRenderId: string;
  diagnostics: boolean;
  reportRouteDataReadiness: (
    routeDataToken: string,
    routeLocation: string,
    ready: boolean,
  ) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const liffId = env.NEXT_PUBLIC_LIFF_ID;

function getCurrentRouteLocation() {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}

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
  serverRenderId = "initial",
  diagnostics = false,
}: {
  children: ReactNode;
  initialAuth: AuthBootstrapState;
  serverRenderId?: string;
  diagnostics?: boolean;
}) {
  const [authState, setAuthState] = useState<AuthState>(() =>
    stateFromBootstrap(initialAuth),
  );
  const authPromiseRef = useRef<Promise<AuthenticationResult> | null>(null);
  const authAttemptIdRef = useRef(0);
  const bootstrapStartedRef = useRef(false);
  const bootstrapRefreshRef = useRef(false);
  const mountedRef = useRef(true);
  const setAuthStateForAttempt = useCallback(
    (attemptId: number, state: AuthState) => {
      if (mountedRef.current && authAttemptIdRef.current === attemptId)
        setAuthState(state);
    },
    [],
  );
  const [serverDataRefreshPending, setServerDataRefreshPending] =
    useState(false);
  const [refreshFailure, setRefreshFailure] = useState<AdminClientError | null>(
    null,
  );
  const [isRouteDataReady, setIsRouteDataReady] = useState(false);
  const pendingRefreshRef = useRef<{
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: AdminClientError) => void;
    startingRenderId: string;
    startingRouteDataToken: string | null;
    startingSubjectUserId: string | null;
    expectedUserId: string | null;
    subjectChanged: boolean;
  } | null>(null);
  const refreshRequiredRef = useRef(false);
  const refreshFailureRef = useRef<AdminClientError | null>(null);
  const routeReadinessRef = useRef<{
    routeDataToken: string;
    routeLocation: string;
    ready: boolean;
  } | null>(null);
  const authStateRef = useRef(authState);
  const serverSubjectRef = useRef<string | null>(null);
  const serverRenderIdRef = useRef(serverRenderId);
  const router = useRouter();
  const serverSubjectUserId =
    initialAuth.status === "ready" ? initialAuth.user.userId : null;
  const resolveFreshRefresh = useCallback(() => {
    if (refreshFailureRef.current) return;
    const waiter = pendingRefreshRef.current;
    const readiness = routeReadinessRef.current;
    if (waiter && serverSubjectRef.current !== waiter.startingSubjectUserId) {
      waiter.subjectChanged = true;
      pendingRefreshRef.current = null;
      refreshRequiredRef.current = true;
      authAttemptIdRef.current += 1;
      authPromiseRef.current = null;
      waiter.reject(
        new AdminClientError(
          "認証主体が変更されたため、操作を中止しました。",
          "AUTH_SUBJECT_CHANGED",
          "authorization",
        ),
      );
      return;
    }
    if (
      waiter &&
      waiter.expectedUserId !== null &&
      readiness &&
      serverRenderIdRef.current !== waiter.startingRenderId &&
      serverSubjectRef.current === waiter.expectedUserId &&
      readiness.routeDataToken !== waiter.startingRouteDataToken &&
      readiness.ready &&
      readiness.routeLocation === getCurrentRouteLocation()
    ) {
      waiter.resolve();
    }
  }, []);
  useLayoutEffect(() => {
    authStateRef.current = authState;
    serverSubjectRef.current = serverSubjectUserId;
    serverRenderIdRef.current = serverRenderId;
    resolveFreshRefresh();
  }, [authState, resolveFreshRefresh, serverSubjectUserId, serverRenderId]);

  useEffect(
    () => () => {
      const pending = pendingRefreshRef.current;
      pendingRefreshRef.current = null;
      refreshRequiredRef.current = false;
      pending?.reject(
        new AdminClientError(
          "認証画面が切り替わったため、最新データを確認できませんでした。",
          "AUTH_SUBJECT_CHANGED",
          "authorization",
        ),
      );
    },
    [],
  );

  const authenticate = useCallback(
    async (attemptId: number): Promise<AuthenticationResult> => {
      if (!liffId) {
        const state = {
          status: "error",
          message:
            "LIFF IDが未設定です。NEXT_PUBLIC_LIFF_IDを設定してください。",
        } satisfies AuthenticationResult;
        setAuthStateForAttempt(attemptId, state);
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
        setAuthStateForAttempt(attemptId, state);
        return state;
      }

      let idToken: string | null;
      let accessToken: string | null;
      try {
        idToken = liff.getIDToken();
        accessToken = liff.getAccessToken();
      } catch {
        const state = {
          status: "error",
          message:
            "LINE認証情報を取得できませんでした。LINEアプリから開き直してください。",
        } satisfies AuthenticationResult;
        setAuthStateForAttempt(attemptId, state);
        return state;
      }
      if (!idToken && !accessToken) {
        const state = {
          status: "error",
          message:
            "LINE認証情報を取得できませんでした。LINEアプリから開き直してください。",
        } satisfies AuthenticationResult;
        setAuthStateForAttempt(attemptId, state);
        return state;
      }

      try {
        const session = await createAdminLineSessionAction({
          idToken,
          accessToken,
        });
        if (session.data) {
          const state = {
            status: "ready",
            user: session.data,
          } satisfies AuthenticationResult;
          setAuthStateForAttempt(attemptId, state);
          return state;
        }
        const code = session.serverError?.code ?? "LINE_AUTH_REQUIRED";
        const message =
          session.serverError?.message ?? "リクエスト形式が正しくありません。";
        const state = {
          status:
            code === "ADMIN_ACCESS_REQUIRED" || code === "ACTOR_NOT_ACTIVE"
              ? "unavailable"
              : "error",
          code,
          message:
            code === "LINE_AUTH_REQUIRED" || code === "LINE_AUTH_FAILED"
              ? `LINE認証に失敗しました。${message}`
              : message,
        } satisfies AuthenticationResult;
        setAuthStateForAttempt(attemptId, state);
        return state;
      } catch {
        const state = {
          status: "error",
          message: "認証処理に失敗しました。",
        } satisfies AuthenticationResult;
        setAuthStateForAttempt(attemptId, state);
        return state;
      }
    },
    [setAuthStateForAttempt],
  );

  const runAuthentication =
    useCallback(async (): Promise<AuthenticationResult> => {
      if (authPromiseRef.current) return authPromiseRef.current;
      const attemptId = ++authAttemptIdRef.current;
      setAuthStateForAttempt(attemptId, {
        status: "checking",
        message: "管理画面を準備しています...",
      });
      const promise = authenticate(attemptId);
      authPromiseRef.current = promise;
      try {
        return await promise;
      } finally {
        if (authPromiseRef.current === promise) authPromiseRef.current = null;
      }
    }, [authenticate, setAuthStateForAttempt]);

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
    if (refreshFailureRef.current) throw refreshFailureRef.current;
    if (!mountedRef.current)
      throw new AdminClientError(
        "認証プロバイダーがアンマウントされています。",
      );
    if (pendingRefreshRef.current) {
      await pendingRefreshRef.current.promise;
      return;
    }

    const startingRenderId = serverRenderId;
    const startingRouteDataToken =
      routeReadinessRef.current?.routeDataToken ?? null;
    let resolveRefresh!: () => void;
    let rejectRefresh!: (error: AdminClientError) => void;
    const refreshPromise = new Promise<void>((resolve, reject) => {
      resolveRefresh = resolve;
      rejectRefresh = reject;
    });
    // A failed authentication can reject this waiter before another caller awaits it.
    void refreshPromise.catch(() => undefined);
    const waiter = {
      promise: refreshPromise,
      resolve: resolveRefresh,
      reject: rejectRefresh,
      startingRenderId,
      startingRouteDataToken,
      startingSubjectUserId: serverSubjectUserId,
      expectedUserId: null as string | null,
      subjectChanged: false,
    };
    pendingRefreshRef.current = waiter;
    refreshRequiredRef.current = true;
    setServerDataRefreshPending(true);

    const finishRefreshWaiter = (confirmed = false) => {
      if (pendingRefreshRef.current === waiter)
        pendingRefreshRef.current = null;
      if (confirmed) {
        refreshRequiredRef.current = false;
      }
      if (mountedRef.current)
        setServerDataRefreshPending(!confirmed && refreshRequiredRef.current);
    };
    let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        runAuthentication(),
        refreshPromise.then(() => {
          throw new AdminClientError(
            "認証画面が切り替わったため、最新データを確認できませんでした。",
            "AUTH_SUBJECT_CHANGED",
            "authorization",
          );
        }),
      ]);
      if (result.status !== "ready") {
        throw clientErrorFromReadState(result);
      }

      waiter.expectedUserId = result.user.userId;
      if (result.user.userId !== serverSubjectUserId) {
        if (serverRenderIdRef.current === startingRenderId) router.refresh();
        throw new AdminClientError(
          "認証主体が変更されたため、操作を中止しました。",
          "AUTH_SUBJECT_CHANGED",
          "authorization",
        );
      }
      resolveFreshRefresh();
      if (serverRenderIdRef.current === startingRenderId) {
        try {
          router.refresh();
        } catch {
          const refreshError = new AdminClientError(
            "認証後の最新データを取得できませんでした。入力中の内容が失われる可能性があります。ページを再読み込みしてください。",
            "SERVER_DATA_REFRESH_FAILED",
            "session",
          );
          refreshFailureRef.current = refreshError;
          setRefreshFailure(refreshError);
          throw refreshError;
        }
      }
      const timeoutError = new AdminClientError(
        "認証後の最新データを確認できませんでした。入力中の内容が失われる可能性があります。ページを再読み込みしてください。",
        "SERVER_DATA_REFRESH_TIMEOUT",
        "session",
      );
      refreshTimeout = setTimeout(() => {
        refreshFailureRef.current = timeoutError;
        setRefreshFailure(timeoutError);
        waiter.reject(timeoutError);
      }, 15_000);
      await refreshPromise;
      finishRefreshWaiter(true);
      return;
    } catch (error) {
      if (waiter.expectedUserId === null && !waiter.subjectChanged) {
        refreshRequiredRef.current = false;
      }
      const authError =
        error instanceof AdminClientError
          ? error
          : clientErrorFromReadState({
              status: "error",
              message: "認証処理に失敗しました。",
            });
      waiter.reject(authError);
      throw authError;
    } finally {
      if (refreshTimeout !== undefined) clearTimeout(refreshTimeout);
      finishRefreshWaiter(false);
    }
  }, [
    resolveFreshRefresh,
    router,
    runAuthentication,
    serverSubjectUserId,
    serverRenderId,
  ]);

  const isSubjectCurrent =
    authState.status === "ready" &&
    serverSubjectUserId !== null &&
    authState.user.userId === serverSubjectUserId &&
    !serverDataRefreshPending;
  const reportRouteDataReadiness = useCallback(
    (routeDataToken: string, reportedRouteLocation: string, ready: boolean) => {
      const readiness = {
        routeDataToken,
        routeLocation: reportedRouteLocation,
        ready,
      };
      routeReadinessRef.current = readiness;
      setIsRouteDataReady(
        ready && reportedRouteLocation === getCurrentRouteLocation(),
      );
      queueMicrotask(() => {
        resolveFreshRefresh();
      });
    },
    [resolveFreshRefresh],
  );
  const canMutate = useCallback(() => {
    const currentAuth = authStateRef.current;
    return (
      pendingRefreshRef.current === null &&
      !refreshRequiredRef.current &&
      currentAuth.status === "ready" &&
      serverSubjectRef.current !== null &&
      currentAuth.user.userId === serverSubjectRef.current &&
      routeReadinessRef.current?.routeLocation === getCurrentRouteLocation() &&
      routeReadinessRef.current.ready
    );
  }, []);

  return (
    <AuthContext.Provider
      value={{
        authState,
        serverSubjectUserId,
        isSubjectCurrent,
        isRouteDataReady,
        refreshFailure,
        canMutate,
        reauthenticate,
        serverRenderId,
        diagnostics,
        reportRouteDataReadiness,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
