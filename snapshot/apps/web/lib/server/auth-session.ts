import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import type {
  AuthBootstrapState,
  AuthenticatedUserSessionState,
} from "../auth-types";
import { reportUnexpectedServerException } from "./server-observability";
import { createTimeCardAuthenticationApplication } from "./users-composition";

const sessionCookieName = "timecard_session";

export async function setTimeCardSessionCookie(
  credential: string,
  expiresAt: Date,
) {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, credential, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

const resolveSession = cache(async () => {
  const credential = (await cookies()).get(sessionCookieName)?.value;
  return createTimeCardAuthenticationApplication().resolveActiveSession(
    credential,
  );
});

const resolveAdminSession = cache(async () => {
  const credential = (await cookies()).get(sessionCookieName)?.value;
  return createTimeCardAuthenticationApplication().resolveActiveAdminSession(
    credential,
  );
});

export async function resolveAuthenticatedUserSession(): Promise<AuthenticatedUserSessionState> {
  try {
    const session = await resolveSession();
    if (!session.ok)
      return { status: "missing", message: "ログインが必要です。" };

    return {
      status: "ready",
      user: session.user,
    };
  } catch (error) {
    reportUnexpectedServerException(error, "auth.session.staff");
    return {
      status: "error",
      message: "認証状態を確認できませんでした。",
    };
  }
}

export async function resolveAdminAuthSession(): Promise<AuthBootstrapState> {
  try {
    const session = await resolveAdminSession();
    if (!session.ok) {
      if (session.code === "SESSION_EXPIRED") {
        return { status: "missing", message: "ログインが必要です。" };
      }
      return {
        status: "unavailable",
        code: session.code,
        message:
          session.code === "ADMIN_ACCESS_REQUIRED"
            ? "このアカウントには管理権限がありません。"
            : "このアカウントは現在、管理画面を利用できません。",
      };
    }

    return {
      status: "ready",
      user: session.user,
    };
  } catch (error) {
    reportUnexpectedServerException(error, "auth.session.admin");
    return {
      status: "error",
      message: "認証状態を確認できませんでした。",
    };
  }
}
