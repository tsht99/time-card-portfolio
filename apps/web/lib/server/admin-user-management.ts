import "server-only";

import type { AdminUsersState } from "../admin-user-management-types";
import { reportUnexpectedServerException } from "../server-observability";
import { resolveAdminAuthSession } from "./auth-session";
import { createTimeCardUserReadApplication } from "./users-access";

function authState(
  session: Awaited<ReturnType<typeof resolveAdminAuthSession>>,
): Exclude<AdminUsersState, { status: "ready" }> {
  if (session.status === "ready") throw new Error("Expected non-ready auth.");
  if (session.status === "unavailable")
    return {
      status: session.status,
      code: session.code,
      message: session.message,
    };
  return { status: session.status, message: session.message };
}

export async function loadAdminUsers(): Promise<AdminUsersState> {
  const session = await resolveAdminAuthSession();
  if (session.status !== "ready") return authState(session);

  try {
    const users = await createTimeCardUserReadApplication().getUsers();
    return { status: "ready", data: users };
  } catch (error) {
    reportUnexpectedServerException(error, "admin.users.read.list");
    return { status: "error", message: "ユーザー一覧を取得できませんでした。" };
  }
}
