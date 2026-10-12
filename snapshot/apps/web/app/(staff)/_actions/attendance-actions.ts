"use server";

import {
  AttendanceAccessForbiddenError,
  AttendanceClockAlreadyWorkingError,
  AttendanceClockCommandRejectedError,
  AttendanceClockProcessingDateMismatchError,
  AttendanceClockStaleError,
  AttendanceTimeOverlapError,
} from "@repo/attendance";
import { createAttendanceEventRequestSchema } from "@repo/contracts";
import { revalidatePath } from "next/cache";
import {
  actionClient,
  authenticatedActionMiddleware,
  returnServerError,
} from "../../../lib/server/action-client";
import { createTimeCardAttendanceApplication } from "../../../lib/server/attendance-composition";
import { getServerReferenceTime } from "../../../lib/server/reference-time";

function sessionExpired(): never {
  return returnServerError({
    code: "SESSION_EXPIRED",
    message: "ログイン状態が切れています。",
  });
}

export const clockStaffAttendanceAction = actionClient
  .inputSchema(createAttendanceEventRequestSchema)
  .metadata({
    operation: "staff.attendance.action.clock",
    fallback: "打刻の保存に失敗しました。",
  })
  .useValidated(authenticatedActionMiddleware)
  .action(async ({ parsedInput, ctx }) => {
    if (ctx.session.status === "missing") return sessionExpired();
    if (ctx.session.status !== "ready")
      return returnServerError({
        code: "ACTION_FAILED",
        message: "打刻の保存に失敗しました。",
      });

    const referenceTime = getServerReferenceTime();
    try {
      await createTimeCardAttendanceApplication({
        now: () => referenceTime,
      }).clock({ userId: ctx.session.user.userId }, parsedInput);
      revalidatePath("/clock");
      return;
    } catch (error) {
      if (error instanceof AttendanceClockProcessingDateMismatchError)
        return returnServerError({
          code: "ATTENDANCE_PROCESSING_DATE_MISMATCH",
          message:
            "打刻対象日が更新されています。画面を再読み込みして、最新の日時で打刻してください。",
        });
      if (error instanceof AttendanceTimeOverlapError)
        return returnServerError({
          code: "ATTENDANCE_TIME_OVERLAP",
          message: error.message,
        });
      if (error instanceof AttendanceClockStaleError)
        return returnServerError({
          code: "ATTENDANCE_CLOCK_STALE",
          message:
            "勤怠の状態が更新されています。最新の状態を確認してから、もう一度操作してください。",
        });
      if (error instanceof AttendanceClockAlreadyWorkingError)
        return returnServerError({
          code: "ATTENDANCE_ALREADY_WORKING",
          message: "退勤していない勤務があります。先に退勤してください。",
        });
      if (error instanceof AttendanceClockCommandRejectedError)
        return returnServerError({
          code: "ACTION_FAILED",
          message: error.message,
        });
      if (error instanceof AttendanceAccessForbiddenError)
        return returnServerError({
          code: "ACTION_FAILED",
          message: "現在、このアカウントでは打刻できません。",
        });
      throw error;
    }
  });
