import "server-only";

import { resolveAuthenticatedUserSession } from "../../../lib/server/auth-session";
import { reportUnexpectedServerException } from "../../../lib/server/server-observability";
import { createTimeCardAdminUserReadApplication } from "../../../lib/server/users-composition";
import type { AdminUserListState } from "./admin-user-management-types.ts";

function authState(
  session: Awaited<ReturnType<typeof resolveAuthenticatedUserSession>>,
): Exclude<AdminUserListState, { status: "ready" }> {
  if (session.status === "ready") throw new Error("Expected non-ready auth.");
  return { status: session.status, message: session.message };
}

export async function loadAdminUsers(): Promise<AdminUserListState> {
  const session = await resolveAuthenticatedUserSession();
  if (session.status !== "ready") return authState(session);

  try {
    const result = await createTimeCardAdminUserReadApplication().getUsers(
      session.user.userId,
    );
    if (result.kind === "actor-forbidden")
      return {
        status: "unavailable",
        code: result.code,
        message:
          result.code === "ACTOR_NOT_ACTIVE"
            ? "アカウントが利用できないため、操作を続けられません。"
            : "この操作を行う権限がありません。",
      };
    if (result.kind !== "success")
      throw new Error("Admin user read transaction failed.");
    const users = result.users;
    return { status: "ready", data: users };
  } catch (error) {
    reportUnexpectedServerException(error, "admin.users.read.list");
    return { status: "error", message: "ユーザー一覧を取得できませんでした。" };
  }
}
