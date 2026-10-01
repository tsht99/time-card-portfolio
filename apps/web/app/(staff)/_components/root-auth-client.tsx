"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "../../../env";
import type { AuthBootstrapState } from "../../../lib/auth-types";
import { useStaffAuth } from "../_hooks/use-staff-auth.ts";
import {
  STAFF_AUTH_CHECKING_MESSAGE,
  StaffAuthStatus,
} from "./staff-auth-status.tsx";

const liffId = env.NEXT_PUBLIC_LIFF_ID;

function hasLiffAuthCallbackUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const callbackQueryKeys = [
    "code",
    "error",
    "error_description",
    "access_token",
    "id_token",
    "liff.state",
    "expires_in",
    "state",
    "token_type",
  ];
  return (
    callbackQueryKeys.some((key) => searchParams.has(key)) ||
    window.location.hash.length > 1
  );
}

export function RootAuthClient({
  initialAuth,
}: {
  initialAuth: AuthBootstrapState;
}) {
  const router = useRouter();
  const navigationStartedRef = useRef(false);
  const [readyAuthError, setReadyAuthError] = useState<string | null>(null);

  const navigateToClock = useCallback(() => {
    if (navigationStartedRef.current) return;
    navigationStartedRef.current = true;
    router.replace("/clock");
  }, [router]);

  const { authStatus, authMessage } = useStaffAuth({
    initialAuth,
    onAuthenticated: navigateToClock,
  });

  useEffect(() => {
    if (initialAuth.status !== "ready") return;

    if (!hasLiffAuthCallbackUrl()) {
      navigateToClock();
      return;
    }

    let isMounted = true;
    async function initializeLiffCallback() {
      if (!liffId) {
        if (isMounted)
          setReadyAuthError(
            "LIFF IDが未設定です。NEXT_PUBLIC_LIFF_IDを設定してください。",
          );
        return;
      }

      try {
        const { default: liff } = await import("@line/liff");
        await liff.init({
          liffId,
          withLoginOnExternalBrowser: false,
        });
        if (isMounted) navigateToClock();
      } catch {
        if (isMounted) setReadyAuthError("認証処理に失敗しました。");
      }
    }

    void initializeLiffCallback();
    return () => {
      isMounted = false;
    };
  }, [initialAuth.status, navigateToClock]);

  if (initialAuth.status === "ready") {
    return (
      <StaffAuthStatus
        active="clock"
        status={readyAuthError ? "error" : "checking"}
        message={readyAuthError ?? STAFF_AUTH_CHECKING_MESSAGE}
      />
    );
  }

  if (authStatus === "ready") return null;

  return (
    <StaffAuthStatus active="clock" status={authStatus} message={authMessage} />
  );
}
