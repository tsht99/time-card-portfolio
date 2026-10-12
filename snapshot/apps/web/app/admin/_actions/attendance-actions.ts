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
  attendanceIdSchema,
  cancelAttendanceRequestSchema,
  correctAttendanceRequestSchema,
  createAdminAttendanceRequestSchema,
} from "@repo/contracts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionSession,
  actionClient,
  authenticatedActionMiddleware,
  returnServerError,
} from "../../../lib/server/action-client";
import { createTimeCardAttendanceApplication } from "../../../lib/server/attendance-composition";

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

function authFailure(session: ActionSession): never {
  if (session.status === "missing")
    return returnServerError({
      code: "SESSION_EXPIRED",
      message: "ログイン状態が切れています。",
    });
  return returnServerError({ code: "ACTION_FAILED", message: session.message });
}
function expected(code: string, message: string): never {
  return returnServerError({ code, message });
}

export const correctAdminAttendanceAction = actionClient
  .inputSchema(correctionInputSchema)
  .metadata({
    operation: "admin.attendance.action.correct",
    fallback: "勤怠の訂正に失敗しました。",
  })
  .useValidated(authenticatedActionMiddleware)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.session.status !== "ready") return authFailure(ctx.session);
    try {
      const result = await createTimeCardAttendanceApplication({}).correct(
        { userId: ctx.session.user.userId },
        parsedInput.attendanceId,
        parsedInput.changes,
      );
      revalidatePath("/admin/attendance");
      revalidatePath(`/admin/attendance/${result.attendanceId}`);
      return result.attendanceId;
    } catch (error) {
      if (error instanceof AttendanceTimeOverlapError)
        return expected("ATTENDANCE_TIME_OVERLAP", error.message);
      if (error instanceof AttendanceCorrectionVersionConflictError)
        return expected("ATTENDANCE_VERSION_CONFLICT", error.message);
      if (
        error instanceof AttendanceCorrectionCommandRejectedError ||
        error instanceof AttendanceCorrectionForbiddenError
      )
        return expected("ACTION_FAILED", error.message);
      throw error;
    }
  });

export const createAdminAttendanceAction = actionClient
  .inputSchema(createAdminAttendanceRequestSchema)
  .metadata({
    operation: "admin.attendance.action.create",
    fallback: "勤怠の新規作成に失敗しました。",
  })
  .useValidated(authenticatedActionMiddleware)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.session.status !== "ready") return authFailure(ctx.session);
    try {
      const result = await createTimeCardAttendanceApplication(
        {},
      ).createAdminAttendance({ userId: ctx.session.user.userId }, parsedInput);
      revalidatePath("/admin/attendance");
      return result.attendanceId;
    } catch (error) {
      if (error instanceof AttendanceTimeOverlapError)
        return expected("ATTENDANCE_TIME_OVERLAP", error.message);
      if (error instanceof AttendanceManualCreationTargetNotFoundError)
        return expected(
          "ACTION_FAILED",
          "対象ユーザーが見つかりません。最新のユーザー一覧を確認してください。",
        );
      if (error instanceof AttendanceManualCreationTargetNotApprovedError)
        return expected(
          "ACTION_FAILED",
          "利用承認待ちのユーザーには勤怠を新規作成できません。",
        );
      if (error instanceof AttendanceManualCreationForbiddenError)
        return expected(
          "ACTION_FAILED",
          "勤怠を新規作成する権限がありません。",
        );
      if (error instanceof AttendanceManualCreationCommandRejectedError)
        return expected(
          "ACTION_FAILED",
          "勤怠を新規作成できませんでした。入力日時と既存の勤怠を確認してください。",
        );
      throw error;
    }
  });

export const cancelAdminAttendanceAction = actionClient
  .inputSchema(cancellationInputSchema)
  .metadata({
    operation: "admin.attendance.action.cancel",
    fallback: "勤怠の取消に失敗しました。",
  })
  .useValidated(authenticatedActionMiddleware)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.session.status !== "ready") return authFailure(ctx.session);
    try {
      const result = await createTimeCardAttendanceApplication({}).cancel(
        { userId: ctx.session.user.userId },
        parsedInput.attendanceId,
        { expectedVersion: parsedInput.expectedVersion },
      );
      revalidatePath("/admin/attendance");
      revalidatePath(`/admin/attendance/${result.attendanceId}`);
      return result.attendanceId;
    } catch (error) {
      if (error instanceof AttendanceCancellationVersionConflictError)
        return expected("ATTENDANCE_VERSION_CONFLICT", error.message);
      if (
        error instanceof AttendanceCancellationCommandRejectedError ||
        error instanceof AttendanceCancellationForbiddenError
      )
        return expected("ACTION_FAILED", error.message);
      throw error;
    }
  });
