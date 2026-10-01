"use server";

import {
  AttendanceCancellationCommandRejectedError,
  AttendanceCancellationForbiddenError,
  AttendanceCancellationVersionConflictError,
  AttendanceCorrectionCommandRejectedError,
  AttendanceCorrectionForbiddenError,
  AttendanceCorrectionVersionConflictError,
  AttendanceManualCreationCommandRejectedError,
  AttendanceManualCreationForbiddenError,
  AttendanceManualCreationTargetNotApprovedError,
  AttendanceManualCreationTargetNotFoundError,
  AttendanceTimeOverlapError,
} from "@repo/attendance";
import {
  adminUserMonthlyPayrollDetailQuerySchema,
  attendanceIdSchema,
  cancelAttendanceRequestSchema,
  correctAttendanceRequestSchema,
  createAdminAttendanceRequestSchema,
  monthlyPayrollSummaryQuerySchema,
} from "@repo/contracts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type {
  AdminAttendanceActionResult,
  AdminMonthlyPayrollSummaryState,
  AdminUserMonthlyPayrollDetailState,
} from "../../../lib/admin-attendance-types";
import type { AuthenticatedTimeCardUser } from "../../../lib/auth-types";
import { loadAdminUserMonthlyPayrollDetail } from "../../../lib/server/admin-attendance";
import { createAttendanceApplication } from "../../../lib/server/attendance-composition";
import { resolveAdminAuthSession } from "../../../lib/server/auth-session";
import { createAdminPayrollQueries } from "../../../lib/server/payroll-composition";
import { reportUnexpectedServerException } from "../../../lib/server-observability";

const invalidRequestMessage = "リクエスト形式が正しくありません。";
const monthlyInputSchema = z
  .object({ month: monthlyPayrollSummaryQuerySchema.shape.month })
  .strict();
const correctionInputSchema = z
  .object({
    attendanceId: attendanceIdSchema,
    changes: correctAttendanceRequestSchema,
  })
  .strict();
const cancellationInputSchema = z
  .object({
    attendanceId: attendanceIdSchema,
    expectedVersion: cancelAttendanceRequestSchema.shape.expectedVersion,
  })
  .strict();
function invalidRequest() {
  return { success: false, message: invalidRequestMessage } as const;
}

async function resolveActor(): Promise<
  | { success: true; actor: AuthenticatedTimeCardUser }
  | { success: false; result: AdminAttendanceActionResult }
> {
  const session = await resolveAdminAuthSession();
  if (session.status === "ready") return { success: true, actor: session.user };
  if (session.status === "missing")
    return {
      success: false,
      result: {
        success: false,
        code: "SESSION_EXPIRED",
        message: "ログイン状態が切れています。",
      },
    };
  if (session.status === "unavailable")
    return {
      success: false,
      result: { success: false, code: session.code, message: session.message },
    };
  return {
    success: false,
    result: { success: false, message: session.message },
  };
}

function readAuthState(
  session: Awaited<ReturnType<typeof resolveAdminAuthSession>>,
): Exclude<AdminMonthlyPayrollSummaryState, { status: "ready" }> {
  if (session.status === "ready") throw new Error("Expected non-ready auth.");
  return {
    status: session.status,
    message: session.message,
    ...(session.status === "unavailable" ? { code: session.code } : {}),
  };
}

export async function getAdminMonthlyPayrollSummaryAction(
  input: unknown,
): Promise<AdminMonthlyPayrollSummaryState> {
  const parsed = monthlyInputSchema.safeParse(input);
  if (!parsed.success)
    return { status: "error", message: invalidRequestMessage };
  const session = await resolveAdminAuthSession();
  if (session.status !== "ready") return readAuthState(session);
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

export async function getAdminUserMonthlyPayrollDetailAction(
  input: unknown,
): Promise<AdminUserMonthlyPayrollDetailState> {
  const parsed = adminUserMonthlyPayrollDetailQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: invalidRequestMessage };
  }
  return loadAdminUserMonthlyPayrollDetail(
    parsed.data.userId,
    parsed.data.month,
  );
}

export async function correctAdminAttendanceAction(
  input: unknown,
): Promise<AdminAttendanceActionResult> {
  const parsed = correctionInputSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const actor = await resolveActor();
    if (!actor.success) return actor.result;
    const result = await createAttendanceApplication({}).correct(
      actor.actor,
      parsed.data.attendanceId,
      parsed.data.changes,
    );
    revalidatePath("/admin/attendance");
    revalidatePath(`/admin/attendance/${result.attendanceId}`);
    return { success: true, attendanceId: result.attendanceId };
  } catch (error) {
    if (error instanceof AttendanceTimeOverlapError)
      return {
        success: false,
        code: "ATTENDANCE_TIME_OVERLAP",
        message: error.message,
      };
    if (error instanceof AttendanceCorrectionVersionConflictError)
      return {
        success: false,
        code: "ATTENDANCE_VERSION_CONFLICT",
        message: error.message,
      };
    if (
      error instanceof AttendanceCorrectionCommandRejectedError ||
      error instanceof AttendanceCorrectionForbiddenError
    )
      return { success: false, message: error.message };
    reportUnexpectedServerException(error, "admin.attendance.action.correct");
    return { success: false, message: "勤怠の訂正に失敗しました。" };
  }
}

export async function createAdminAttendanceAction(
  input: unknown,
): Promise<AdminAttendanceActionResult> {
  const parsed = createAdminAttendanceRequestSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const actor = await resolveActor();
    if (!actor.success) return actor.result;
    const result = await createAttendanceApplication({}).createAdminAttendance(
      actor.actor,
      parsed.data,
    );
    revalidatePath("/admin/attendance");
    return { success: true, attendanceId: result.attendanceId };
  } catch (error) {
    if (error instanceof AttendanceTimeOverlapError)
      return {
        success: false,
        code: "ATTENDANCE_TIME_OVERLAP",
        message: error.message,
      };
    if (error instanceof AttendanceManualCreationTargetNotFoundError)
      return {
        success: false,
        message:
          "対象ユーザーが見つかりません。最新のユーザー一覧を確認してください。",
      };
    if (error instanceof AttendanceManualCreationTargetNotApprovedError)
      return {
        success: false,
        message: "利用承認待ちのユーザーには勤怠を新規作成できません。",
      };
    if (error instanceof AttendanceManualCreationForbiddenError)
      return {
        success: false,
        message: "勤怠を新規作成する権限がありません。",
      };
    if (error instanceof AttendanceManualCreationCommandRejectedError)
      return {
        success: false,
        message:
          "勤怠を新規作成できませんでした。入力日時と既存の勤怠を確認してください。",
      };
    reportUnexpectedServerException(error, "admin.attendance.action.create");
    return { success: false, message: "勤怠の新規作成に失敗しました。" };
  }
}

export async function cancelAdminAttendanceAction(
  input: unknown,
): Promise<AdminAttendanceActionResult> {
  const parsed = cancellationInputSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  try {
    const actor = await resolveActor();
    if (!actor.success) return actor.result;
    const result = await createAttendanceApplication({}).cancel(
      actor.actor,
      parsed.data.attendanceId,
      {
        expectedVersion: parsed.data.expectedVersion,
      },
    );
    revalidatePath("/admin/attendance");
    revalidatePath(`/admin/attendance/${result.attendanceId}`);
    return { success: true, attendanceId: result.attendanceId };
  } catch (error) {
    if (error instanceof AttendanceCancellationVersionConflictError)
      return {
        success: false,
        code: "ATTENDANCE_VERSION_CONFLICT",
        message: error.message,
      };
    if (
      error instanceof AttendanceCancellationCommandRejectedError ||
      error instanceof AttendanceCancellationForbiddenError
    )
      return { success: false, message: error.message };
    reportUnexpectedServerException(error, "admin.attendance.action.cancel");
    return { success: false, message: "勤怠の取消に失敗しました。" };
  }
}
