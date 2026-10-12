import "server-only";
import {
  adminUserMonthlyPayrollEstimateDetailQuerySchema,
  monthlyPayrollEstimateSummaryQuerySchema,
} from "@repo/contracts";
import { resolveAuthenticatedUserSession } from "../../../lib/server/auth-session";
import {
  createAdminPayrollEstimateQueries,
  isPayrollEstimateTargetUserNotFoundError,
  PayrollEstimateForbiddenError,
} from "../../../lib/server/payroll-composition";
import { reportUnexpectedServerException } from "../../../lib/server/server-observability";
import type {
  AdminMonthlyPayrollEstimateSummaryState,
  AdminUserMonthlyPayrollEstimateDetailState,
} from "./admin-payroll-estimate-types.ts";

function payrollAuthState(
  session: Awaited<ReturnType<typeof resolveAuthenticatedUserSession>>,
) {
  if (session.status === "ready") throw new Error("Expected non-ready auth.");
  return {
    status: session.status,
    message: session.message,
  } as const;
}

function toIsoOrNull(value: Date | null): string | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return null;
  return value.toISOString();
}

export async function loadAdminMonthlyPayrollEstimateSummary(
  month: string,
): Promise<AdminMonthlyPayrollEstimateSummaryState> {
  const parsed = monthlyPayrollEstimateSummaryQuerySchema.safeParse({ month });
  if (!parsed.success)
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ??
        "給与見込み一覧を取得できませんでした。",
    };

  const session = await resolveAuthenticatedUserSession();
  if (session.status !== "ready") return payrollAuthState(session);

  try {
    const summary =
      await createAdminPayrollEstimateQueries().getMonthlyPayrollEstimateSummary(
        session.user.userId,
        parsed.data.month,
      );
    return { status: "ready", data: summary.summaries };
  } catch (error) {
    if (error instanceof PayrollEstimateForbiddenError) {
      if (error.code === "TARGET_FORBIDDEN")
        return { status: "missing", message: "対象ユーザーが見つかりません。" };
      return {
        status: "unavailable",
        code: error.code,
        message:
          error.code === "ACTOR_NOT_ACTIVE"
            ? "アカウントが利用できないため、操作を続けられません。"
            : "この操作を行う権限がありません。",
      };
    }
    reportUnexpectedServerException(error, "admin.payroll-estimate.read.list");
    return {
      status: "error",
      message: "給与見込み一覧を取得できませんでした。",
    };
  }
}

export async function loadAdminUserMonthlyPayrollEstimateDetail(
  userId: string,
  month: string,
): Promise<AdminUserMonthlyPayrollEstimateDetailState> {
  const parsed = adminUserMonthlyPayrollEstimateDetailQuerySchema.safeParse({
    userId,
    month,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "スタッフ別給与見込み詳細を取得できませんでした。",
    };
  }

  const session = await resolveAuthenticatedUserSession();
  if (session.status !== "ready") return payrollAuthState(session);

  try {
    const detail =
      await createAdminPayrollEstimateQueries().getUserMonthlyPayrollEstimateDetail(
        session.user.userId,
        parsed.data.userId,
        parsed.data.month,
      );
    return {
      status: "ready",
      data: {
        ...detail,
        attendances: detail.attendances.map((attendance) => ({
          ...attendance,
          clockInAt: toIsoOrNull(attendance.clockInAt),
          clockOutAt: toIsoOrNull(attendance.clockOutAt),
        })),
      },
    };
  } catch (error) {
    if (error instanceof PayrollEstimateForbiddenError) {
      if (error.code === "TARGET_FORBIDDEN")
        return { status: "missing", message: "対象ユーザーが見つかりません。" };
      return {
        status: "unavailable",
        code: error.code,
        message:
          error.code === "ACTOR_NOT_ACTIVE"
            ? "アカウントが利用できないため、操作を続けられません。"
            : "この操作を行う権限がありません。",
      };
    }
    if (isPayrollEstimateTargetUserNotFoundError(error)) {
      return { status: "missing", message: "対象ユーザーが見つかりません。" };
    }
    reportUnexpectedServerException(
      error,
      "admin.payroll-estimate.read.detail",
    );
    return {
      status: "error",
      message: "スタッフ別給与見込み詳細を取得できませんでした。",
    };
  }
}
