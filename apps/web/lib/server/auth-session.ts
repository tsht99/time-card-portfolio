import "server-only";

import { authorizeActiveAdmin, authorizeActiveUser } from "@repo/users";
import { cookies } from "next/headers";
import { cache } from "react";
import type { AuthBootstrapState } from "../auth-types";
import { reportUnexpectedServerException } from "../server-observability";
import { createTimeCardAuthenticationApplication } from "./users-access";

const sessionCookieName = "timecard_session";

export async function setTimeCardSessionCookie(
  sessionId: string,
  expiresAt: Date,
) {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

const resolveSession = cache(async () => {
  const sessionId = (await cookies()).get(sessionCookieName)?.value;
  return createTimeCardAuthenticationApplication().resolveActiveSession(
    sessionId,
  );
});

export async function resolveStaffAuthSession(): Promise<AuthBootstrapState> {
  try {
    const session = await resolveSession();
    if (!session.ok)
      return { status: "missing", message: "ログインが必要です。" };

    const authorized = authorizeActiveUser(session.user);
    if (!authorized.ok)
      return { status: "missing", message: "ログインが必要です。" };

    return {
      status: "ready",
      user: authorized.user,
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
    const session = await resolveSession();
    if (!session.ok)
      return { status: "missing", message: "ログインが必要です。" };

    const authorized = authorizeActiveAdmin(session.user);
    if (!authorized.ok) {
      if (authorized.code === "SESSION_EXPIRED") {
        return { status: "missing", message: "ログインが必要です。" };
      }

      return {
        status: "unavailable",
        code: authorized.code,
        message:
          authorized.code === "ADMIN_ACCESS_REQUIRED"
            ? "このアカウントには管理権限がありません。"
            : "このアカウントは現在、管理画面を利用できません。",
      };
    }

    return {
      status: "ready",
      user: authorized.user,
    };
  } catch (error) {
    reportUnexpectedServerException(error, "auth.session.admin");
    return {
      status: "error",
      message: "認証状態を確認できませんでした。",
    };
  }
}
