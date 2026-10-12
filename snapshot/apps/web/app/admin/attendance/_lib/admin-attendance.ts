import "server-only";

import {
  type AdminAttendanceList,
  AttendanceAccessForbiddenError,
  AttendanceEventStreamNotFoundError,
} from "@repo/attendance";
import { attendanceIdSchema, attendanceListQuerySchema } from "@repo/contracts";
import { createTimeCardAttendanceApplication } from "../../../../lib/server/attendance-composition";
import { resolveAuthenticatedUserSession } from "../../../../lib/server/auth-session";
import {
  createAdminPayrollEstimateQueries,
  PayrollEstimateForbiddenError,
} from "../../../../lib/server/payroll-composition";
import { reportUnexpectedServerException } from "../../../../lib/server/server-observability";
import type { AttendanceFilters } from "./admin-attendance-filters";
import type {
  AdminAttendanceDetailState,
  AdminAttendanceListState,
} from "./admin-attendance-types.ts";

function authState(
  session: Awaited<ReturnType<typeof resolveAuthenticatedUserSession>>,
): Exclude<AdminAttendanceListState, { status: "ready" }> {
  if (session.status === "ready") throw new Error("Expected non-ready auth.");
  return {
    status: session.status,
    message: session.message,
  };
}

function forbiddenState(code: "ADMIN_ACCESS_REQUIRED" | "ACTOR_NOT_ACTIVE") {
  return {
    status: "unavailable" as const,
    code,
    message:
      code === "ADMIN_ACCESS_REQUIRED"
        ? "この操作を行う権限がありません。"
        : "アカウントが利用できないため、操作を続けられません。",
  };
}

function normalizeFilters(filters: AttendanceFilters) {
  return {
    from: filters.startAttendanceDateInclusive,
    to: filters.endAttendanceDateInclusive,
    ...(filters.userId === "" ? {} : { userId: filters.userId }),
    ...(filters.workPeriod === "" ? {} : { workPeriod: filters.workPeriod }),
    ...(filters.status === "" ? {} : { status: filters.status }),
  };
}

function normalizeAttendanceFilters(filters: AttendanceFilters) {
  return normalizeFilters(
    filters.status === "cancelled" ? { ...filters, status: "" } : filters,
  );
}

export async function loadAdminAttendance(
  filters: AttendanceFilters,
): Promise<AdminAttendanceListState> {
  const parsed = attendanceListQuerySchema.safeParse(
    normalizeAttendanceFilters(filters),
  );
  if (!parsed.success)
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "勤怠一覧を取得できませんでした。",
    };

  const session = await resolveAuthenticatedUserSession();
  if (session.status !== "ready") return authState(session);
  try {
    const result = await createTimeCardAttendanceApplication(
      {},
    ).getAdminAttendance(
      { userId: session.user.userId },
      {
        startAttendanceDateInclusive: parsed.data.from,
        endAttendanceDateInclusive: parsed.data.to,
        ...(parsed.data.userId === undefined
          ? {}
          : { userId: parsed.data.userId }),
        ...(parsed.data.workPeriod === undefined
          ? {}
          : { workPeriod: parsed.data.workPeriod }),
        ...(parsed.data.status === undefined
          ? {}
          : { status: parsed.data.status }),
      },
    );
    return {
      status: "ready",
      data: result,
    };
  } catch (error) {
    if (error instanceof AttendanceAccessForbiddenError)
      return forbiddenState("ADMIN_ACCESS_REQUIRED");
    reportUnexpectedServerException(error, "admin.attendance.read.list");
    return { status: "error", message: "勤怠一覧を取得できませんでした。" };
  }
}

export async function loadAdminAttendanceDetail(
  attendanceId: string,
): Promise<AdminAttendanceDetailState> {
  if (!attendanceIdSchema.safeParse(attendanceId).success) {
    return { status: "error", message: "勤怠詳細を取得できませんでした。" };
  }

  const session = await resolveAuthenticatedUserSession();
  if (session.status !== "ready") return authState(session);

  try {
    const detail =
      await createAdminPayrollEstimateQueries().getAdminAttendanceDetailWithPayrollEstimate(
        { userId: session.user.userId },
        attendanceId,
      );
    return { status: "ready", data: detail };
  } catch (error) {
    if (error instanceof AttendanceEventStreamNotFoundError) {
      return { status: "missing", message: "勤怠が見つかりません。" };
    }
    if (error instanceof AttendanceAccessForbiddenError)
      return forbiddenState("ADMIN_ACCESS_REQUIRED");
    if (error instanceof PayrollEstimateForbiddenError) {
      if (error.code === "TARGET_FORBIDDEN")
        return { status: "missing", message: "勤怠が見つかりません。" };
      return forbiddenState(error.code);
    }
    reportUnexpectedServerException(error, "admin.attendance.read.detail");
    return { status: "error", message: "勤怠詳細を取得できませんでした。" };
  }
}

export function mapAdminAttendanceRows(
  result: AdminAttendanceList,
  users: readonly { userId: string; displayName: string | null }[],
) {
  const names = new Map(users.map((user) => [user.userId, user.displayName]));
  return {
    attendance: result.attendances.map((item) => ({
      ...item,
      displayName: names.get(item.userId) ?? null,
    })),
    cancelledAttendance: result.cancelledAttendances.map((item) => ({
      ...item,
      displayName: names.get(item.userId) ?? null,
    })),
  };
}
