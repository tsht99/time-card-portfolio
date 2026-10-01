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

  const refreshSession = useCallback(async () => {
    if (!liffId)
      return {
        success: false as const,
        code: "LINE_AUTH_REQUIRED" as const,
        message: "LIFF IDが未設定です。NEXT_PUBLIC_LIFF_IDを設定してください。",
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
    const inFlight =
      reauthenticationPromiseRef.current ??
      (() => {
        const promise = refreshSession();
        reauthenticationPromiseRef.current = promise;
        return promise;
      })();
    try {
      return await inFlight;
    } finally {
      if (reauthenticationPromiseRef.current === inFlight)
        reauthenticationPromiseRef.current = null;
    }
  }, [refreshSession]);

  useEffect(() => {
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
        if (!session.success) {
          setAuthStatus(
            session.code === "USER_PENDING"
              ? "pending"
              : session.code === "USER_INACTIVE"
                ? "inactive"
                : "error",
          );
          setAuthMessage(session.message);
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
    };
  }, [initialAuth, onAuthenticated, refreshSession]);

  const isCurrentAuthBootstrap = authBootstrap === initialAuth;
  const visibleAuthStatus: AuthStatus =
    initialAuth.status === "ready"
      ? "ready"
      : initialAuth.status === "missing"
        ? !isCurrentAuthBootstrap
          ? "checking"
          : authStatus
        : "error";
  const visibleAuthMessage =
    initialAuth.status === "ready"
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
