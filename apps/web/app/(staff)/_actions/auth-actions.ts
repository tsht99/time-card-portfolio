"use server";

import { authorizeActiveAdmin, authorizeActiveUser } from "@repo/users";
import { z } from "zod";
import type { LineSessionActionResult } from "../../../lib/auth-types";
import { setTimeCardSessionCookie } from "../../../lib/server/auth-session";
import { createTimeCardAuthenticationApplication } from "../../../lib/server/users-access";
import {
  reportLineServiceUnavailable,
  reportUnexpectedServerException,
} from "../../../lib/server-observability";

const lineSessionInputSchema = z
  .object({
    idToken: z.string().min(1).nullable(),
    accessToken: z.string().min(1).nullable(),
  })
  .strict();

type Authorization = typeof authorizeActiveUser | typeof authorizeActiveAdmin;

function failure(
  code: Extract<LineSessionActionResult, { success: false }>["code"],
  message: string,
): LineSessionActionResult {
  return { success: false, code, message };
}

async function createLineSession(
  input: unknown,
  authorize: Authorization,
  operation: string,
): Promise<LineSessionActionResult> {
  const parsed = lineSessionInputSchema.safeParse(input);
  if (!parsed.success)
    return failure("LINE_AUTH_REQUIRED", "LINE認証情報がありません。");

  try {
    const application = createTimeCardAuthenticationApplication();
    const session = await application.authenticateWithLine(parsed.data);
    if (!session.ok) {
      if (session.code === "LINE_SERVICE_UNAVAILABLE" && session.reason) {
        reportLineServiceUnavailable(operation, session.reason);
      }
      return failure(session.code, session.message);
    }

    await setTimeCardSessionCookie(session.sessionId, session.expiresAt);
    const resolved = await application.resolveActiveSession(session.sessionId);
    if (!resolved.ok)
      return failure("SESSION_CREATION_FAILED", "ログイン処理に失敗しました。");

    const authorized = authorize(resolved.user);
    if (!authorized.ok) {
      const code =
        authorized.code === "SESSION_EXPIRED"
          ? "SESSION_CREATION_FAILED"
          : authorized.code;
      return failure(
        code,
        code === "ADMIN_ACCESS_REQUIRED"
          ? "このアカウントには管理権限がありません。"
          : "このアカウントは現在利用できません。",
      );
    }
    return {
      success: true,
      user: authorized.user,
    };
  } catch (error) {
    reportUnexpectedServerException(error, operation);
    return failure("SESSION_CREATION_FAILED", "ログイン処理に失敗しました。");
  }
}

export async function createStaffLineSessionAction(
  input: unknown,
): Promise<LineSessionActionResult> {
  return createLineSession(
    input,
    authorizeActiveUser,
    "auth.action.create_staff_session",
  );
}

export async function createAdminLineSessionAction(
  input: unknown,
): Promise<LineSessionActionResult> {
  return createLineSession(
    input,
    authorizeActiveAdmin,
    "auth.action.create_admin_session",
  );
}
