"use server";

import { z } from "zod";
import {
  actionClient,
  returnServerError,
} from "../../../lib/server/action-client";
import { setTimeCardSessionCookie } from "../../../lib/server/auth-session";
import { reportLineServiceUnavailable } from "../../../lib/server/server-observability";
import { createTimeCardAuthenticationApplication } from "../../../lib/server/users-composition";

const lineSessionInputSchema = z
  .object({
    idToken: z.string().min(1).nullable(),
    accessToken: z.string().min(1).nullable(),
  })
  .strict();

function createLineSessionAction(adminOnly: boolean, operation: string) {
  return actionClient
    .inputSchema(lineSessionInputSchema)
    .metadata({
      operation,
      fallback: "ログイン処理に失敗しました。",
    })
    .action(async ({ parsedInput }) => {
      const application = createTimeCardAuthenticationApplication();
      const session = adminOnly
        ? await application.authenticateAdminWithLine(parsedInput)
        : await application.authenticateWithLine(parsedInput);
      if (!session.ok) {
        if (session.code === "LINE_SERVICE_UNAVAILABLE" && session.reason) {
          reportLineServiceUnavailable(operation, session.reason);
        }
        return returnServerError({
          code: session.code,
          message: session.message,
        });
      }

      const resolved = adminOnly
        ? await application.resolveActiveAdminSession(session.credential)
        : await application.resolveActiveSession(session.credential);
      if (!resolved.ok) {
        const code =
          resolved.code === "SESSION_EXPIRED"
            ? "SESSION_CREATION_FAILED"
            : resolved.code;
        return returnServerError({
          code,
          message:
            code === "ADMIN_ACCESS_REQUIRED"
              ? "このアカウントには管理権限がありません。"
              : code === "ACTOR_NOT_ACTIVE"
                ? "このアカウントは現在利用できません。"
                : "ログイン処理に失敗しました。",
        });
      }

      await setTimeCardSessionCookie(session.credential, session.expiresAt);
      return resolved.user;
    });
}

export const createStaffLineSessionAction = createLineSessionAction(
  false,
  "auth.action.create_staff_session",
);

export const createAdminLineSessionAction = createLineSessionAction(
  true,
  "auth.action.create_admin_session",
);
