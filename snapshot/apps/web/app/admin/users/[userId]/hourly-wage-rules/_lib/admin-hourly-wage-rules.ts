import "server-only";
import { resolveAuthenticatedUserSession } from "../../../../../../lib/server/auth-session";
import { createHourlyWageRuleManagementApplication } from "../../../../../../lib/server/payroll-composition";
import { reportUnexpectedServerException } from "../../../../../../lib/server/server-observability";
import type { AdminHourlyWageRulesState } from "./admin-hourly-wage-rules-types.ts";

function readAuthState(
  session: Awaited<ReturnType<typeof resolveAuthenticatedUserSession>>,
) {
  if (session.status === "ready") throw new Error("Expected non-ready auth.");
  if (session.status === "missing")
    return { status: "missing", message: session.message } as const;
  return { status: "error", message: session.message } as const;
}

export async function loadAdminHourlyWageRules(
  userId: string,
): Promise<AdminHourlyWageRulesState> {
  const session = await resolveAuthenticatedUserSession();
  if (session.status !== "ready") return readAuthState(session);

  try {
    const result =
      await createHourlyWageRuleManagementApplication().getHourlyWageRules({
        actorUserId: session.user.userId,
        userId,
      });
    if (result.kind === "user-not-found") {
      return {
        status: "missing",
        message: "対象ユーザーが見つかりません。",
      };
    }
    if (result.kind === "role-forbidden")
      return {
        status: "unavailable",
        code: "ADMIN_ACCESS_REQUIRED",
        message: "この操作を行う権限がありません。",
      };
    return { status: "ready", data: result.hourlyWageRules };
  } catch (error) {
    reportUnexpectedServerException(error, "admin.hourly-wage-rules.read");
    return {
      status: "error",
      message: "時給ルールの履歴を取得できませんでした。",
    };
  }
}
