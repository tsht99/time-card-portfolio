"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "../../../env";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import { createStaffLineSessionAction } from "../_actions/auth-actions.ts";
import { STAFF_AUTH_CHECKING_MESSAGE } from "../_components/staff-auth-status.tsx";

export type AuthStatus =
  | "checking"
  | "ready"
  | "missing"
  | "pending"
  | "inactive"
  | "error";

const liffId = env.NEXT_PUBLIC_LIFF_ID;

export function useStaffAuth({
  initialAuth,
  onAuthenticated,
}: {
  initialAuth: AuthBootstrapState;
  onAuthenticated: () => void;
}) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>(() =>
    initialAuth.status === "ready"
      ? "ready"
      : initialAuth.status === "missing"
        ? "checking"
        : "error",
  );
  const [authMessage, setAuthMessage] = useState(() =>
    initialAuth.status === "ready"
      ? "認証が完了しました。"
      : initialAuth.status === "missing"
        ? STAFF_AUTH_CHECKING_MESSAGE
        : initialAuth.message,
  );
  const [authBootstrap, setAuthBootstrap] =
    useState<AuthBootstrapState>(initialAuth);
  const [reauthStatus, setReauthStatus] = useState<AuthStatus | null>(null);
  const [reauthMessage, setReauthMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refreshSession = useCallback(async () => {
    if (!liffId)
      return {
        serverError: {
          code: "LINE_AUTH_REQUIRED",
          message:
            "LIFF IDが未設定です。NEXT_PUBLIC_LIFF_IDを設定してください。",
        },
      };
    const { default: liff } = await import("@line/liff");
    await liff.init({ liffId, withLoginOnExternalBrowser: true });
    return createStaffLineSessionAction({
      idToken: liff.getIDToken(),
      accessToken: liff.getAccessToken(),
    });
  }, []);

  const reauthenticationPromiseRef = useRef<ReturnType<
    typeof refreshSession
  > | null>(null);
  const reauthenticate = useCallback(async () => {
    if (reauthenticationPromiseRef.current)
      return reauthenticationPromiseRef.current;

    setReauthStatus("checking");
    setReauthMessage(STAFF_AUTH_CHECKING_MESSAGE);
    const promise = (async () => {
      try {
        const session = await refreshSession();
        if (!mountedRef.current) return session;

        if (session.serverError || session.validationErrors) {
          const code = session.serverError?.code;
          const status: AuthStatus =
            code === "USER_PENDING"
              ? "pending"
              : code === "USER_INACTIVE"
                ? "inactive"
                : "error";
          setReauthStatus(status);
          setReauthMessage(
            session.serverError?.message ??
              "リクエスト形式が正しくありません。",
          );
          return session;
        }
        if (!session.data) {
          setReauthStatus("error");
          setReauthMessage("認証処理に失敗しました。");
          return session;
        }

        if (
          initialAuth.status === "ready" &&
          session.data.userId !== initialAuth.user.userId
        ) {
          // Keep the screen hidden until the server confirms the new subject.
          onAuthenticated();
          return session;
        }

        setReauthStatus(null);
        setReauthMessage(null);
        setAuthStatus("ready");
        setAuthMessage("認証が完了しました。");
        return session;
      } catch (error) {
        if (mountedRef.current) {
          setReauthStatus("error");
          setReauthMessage("認証処理に失敗しました。");
        }
        throw error;
      }
    })();
    reauthenticationPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (reauthenticationPromiseRef.current === promise)
        reauthenticationPromiseRef.current = null;
    }
  }, [initialAuth, onAuthenticated, refreshSession]);

  useEffect(() => {
    mountedRef.current = true;
    let isMounted = true;
    async function initializeAuth() {
      if (initialAuth.status === "ready") {
        setAuthStatus("ready");
        setAuthMessage("認証が完了しました。");
        return;
      }
      if (initialAuth.status !== "missing") {
        setAuthStatus("error");
        setAuthMessage(initialAuth.message);
        return;
      }
      setAuthStatus("checking");
      setAuthMessage(STAFF_AUTH_CHECKING_MESSAGE);
      try {
        const session = await refreshSession();
        if (!isMounted) return;
        setAuthBootstrap(initialAuth);
        if (session.serverError || session.validationErrors) {
          const code = session.serverError?.code;
          setAuthStatus(
            code === "USER_PENDING"
              ? "pending"
              : code === "USER_INACTIVE"
                ? "inactive"
                : "error",
          );
          setAuthMessage(
            session.serverError?.message ??
              "リクエスト形式が正しくありません。",
          );
          return;
        }
        if (!session.data) {
          setAuthStatus("error");
          setAuthMessage("認証処理に失敗しました。");
          return;
        }
        setAuthMessage("認証が完了しました。");
        onAuthenticated();
      } catch {
        if (!isMounted) return;
        setAuthBootstrap(initialAuth);
        setAuthStatus("error");
        setAuthMessage("認証処理に失敗しました。");
      }
    }
    void initializeAuth();
    return () => {
      isMounted = false;
      mountedRef.current = false;
    };
  }, [initialAuth, onAuthenticated, refreshSession]);

  const isCurrentAuthBootstrap = authBootstrap === initialAuth;
  const visibleAuthStatus: AuthStatus =
    reauthStatus ??
    (initialAuth.status === "ready"
      ? "ready"
      : initialAuth.status === "missing"
        ? !isCurrentAuthBootstrap
          ? "checking"
          : authStatus
        : "error");
  const visibleAuthMessage = reauthStatus
    ? (reauthMessage ?? STAFF_AUTH_CHECKING_MESSAGE)
    : initialAuth.status === "ready"
      ? "認証が完了しました。"
      : initialAuth.status === "missing"
        ? !isCurrentAuthBootstrap
          ? STAFF_AUTH_CHECKING_MESSAGE
          : authMessage
        : initialAuth.message;

  return {
    authStatus: visibleAuthStatus,
    authMessage: visibleAuthMessage,
    reauthenticate,
  };
}
