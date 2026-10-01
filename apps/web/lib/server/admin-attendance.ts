import "server-only";

import { AttendanceEventStreamNotFoundError } from "@repo/attendance";
import {
  adminUserMonthlyPayrollDetailQuerySchema,
  attendanceIdSchema,
  attendanceListQuerySchema,
  monthlyPayrollSummaryQuerySchema,
} from "@repo/contracts";
import type { AttendanceFilters } from "../admin-attendance-filters";
import type {
  AdminAttendanceDetailState,
  AdminAttendanceListState,
  AdminCancelledAttendanceListState,
  AdminMonthlyPayrollSummaryState,
  AdminUserMonthlyPayrollDetailState,
} from "../admin-attendance-types";
import { reportUnexpectedServerException } from "../server-observability";
import { createAttendanceApplication } from "./attendance-composition";
import { resolveAdminAuthSession } from "./auth-session";
import {
  createAdminPayrollQueries,
  isPayrollTargetUserNotFoundError,
} from "./payroll-composition";

function authState(
  session: Awaited<ReturnType<typeof resolveAdminAuthSession>>,
): Exclude<AdminAttendanceListState, { status: "ready" }> {
  if (session.status === "ready") throw new Error("Expected non-ready auth.");
  return {
    status: session.status,
    message: session.message,
    ...(session.status === "unavailable" ? { code: session.code } : {}),
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

function normalizeAttendanceListFilters(filters: AttendanceFilters) {
  return normalizeFilters(
    filters.status === "cancelled" ? { ...filters, status: "" } : filters,
  );
}

export async function loadAdminAttendanceList(
  filters: AttendanceFilters,
): Promise<AdminAttendanceListState> {
  const parsed = attendanceListQuerySchema.safeParse(
    normalizeAttendanceListFilters(filters),
  );
  if (!parsed.success)
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "勤怠一覧を取得できませんでした。",
    };

  const session = await resolveAdminAuthSession();
  if (session.status !== "ready") return authState(session);
  if (filters.status === "cancelled") return { status: "ready", data: [] };

  try {
    const attendance = await createAttendanceApplication(
      {},
    ).getAdminAttendanceList({
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
    });
    return { status: "ready", data: attendance };
  } catch (error) {
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

  const session = await resolveAdminAuthSession();
  if (session.status !== "ready") return authState(session);

  try {
    const detail =
      await createAdminPayrollQueries().getAdminAttendanceDetailWithPayroll(
        attendanceId,
      );
    return { status: "ready", data: detail };
  } catch (error) {
    if (error instanceof AttendanceEventStreamNotFoundError) {
      return { status: "missing", message: "勤怠が見つかりません。" };
    }
    reportUnexpectedServerException(error, "admin.attendance.read.detail");
    return { status: "error", message: "勤怠詳細を取得できませんでした。" };
  }
}

export async function loadAdminCancelledAttendanceList(
  filters: AttendanceFilters,
): Promise<AdminCancelledAttendanceListState> {
  const parsed = attendanceListQuerySchema.safeParse(
    normalizeAttendanceListFilters(filters),
  );
  if (!parsed.success)
    return {
      status: "error",
      message: "取消済み勤怠を取得できませんでした。",
    };

  const session = await resolveAdminAuthSession();
  if (session.status !== "ready") return authState(session);
  if (filters.status !== "" && filters.status !== "cancelled") {
    return { status: "ready", data: [] };
  }

  try {
    const { from, to, userId, workPeriod } = parsed.data;
    const attendance = await createAttendanceApplication(
      {},
    ).getAdminCancelledAttendanceList({
      startAttendanceDateInclusive: from,
      endAttendanceDateInclusive: to,
      ...(userId === undefined ? {} : { userId }),
      ...(workPeriod === undefined ? {} : { workPeriod }),
    });
    return { status: "ready", data: attendance };
  } catch (error) {
    reportUnexpectedServerException(
      error,
      "admin.attendance.read.cancelled-list",
    );
    return { status: "error", message: "取消済み勤怠を取得できませんでした。" };
  }
}

export async function loadAdminMonthlyPayrollSummary(
  month: string,
): Promise<AdminMonthlyPayrollSummaryState> {
  const parsed = monthlyPayrollSummaryQuerySchema.safeParse({ month });
  if (!parsed.success)
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "給与一覧を取得できませんでした。",
    };

  const session = await resolveAdminAuthSession();
  if (session.status !== "ready") return authState(session);

  try {
    const summary = await createAdminPayrollQueries().getMonthlyPayrollSummary(
      parsed.data.month,
    );
    return { status: "ready", data: summary.summaries };
  } catch (error) {
    reportUnexpectedServerException(error, "admin.payroll.read.list");
    return { status: "error", message: "給与一覧を取得できませんでした。" };
  }
}

export async function loadAdminUserMonthlyPayrollDetail(
  userId: string,
  month: string,
): Promise<AdminUserMonthlyPayrollDetailState> {
  const parsed = adminUserMonthlyPayrollDetailQuerySchema.safeParse({
    userId,
    month,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "スタッフ別給与詳細を取得できませんでした。",
    };
  }

  const session = await resolveAdminAuthSession();
  if (session.status !== "ready") return authState(session);

  try {
    const detail =
      await createAdminPayrollQueries().getUserMonthlyPayrollDetail(
        parsed.data.userId,
        parsed.data.month,
      );
    return { status: "ready", data: detail };
  } catch (error) {
    if (isPayrollTargetUserNotFoundError(error)) {
      return { status: "missing", message: "対象ユーザーが見つかりません。" };
    }
    reportUnexpectedServerException(error, "admin.payroll.read.detail");
    return {
      status: "error",
      message: "スタッフ別給与詳細を取得できませんでした。",
    };
  }
}
